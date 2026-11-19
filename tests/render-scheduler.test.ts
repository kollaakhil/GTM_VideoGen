import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cached, fileCache, inputHash, memoryCache, stable } from "@/lib/render/cache";
import { isFatal, runParallel, type RenderJob } from "@/lib/render/scheduler";
import { summarizeTimings, timer, type StageTiming } from "@/lib/render/timing";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const job = (id: string, run: RenderJob<string>["run"], key = id): RenderJob<string> => ({ id, key, run });

describe("runParallel", () => {
  it("never runs more than `limit` at once, and keeps results in job order", async () => {
    let live = 0, peak = 0;
    const jobs = Array.from({ length: 9 }, (_, i) => job(`s${i}`, async () => { live++; peak = Math.max(peak, live); await sleep(5 + (i % 3) * 4); live--; return `v${i}`; }));
    const r = await runParallel(jobs, { limit: 4 });
    expect(peak).toBe(4);
    expect(r.map((x) => x.value)).toEqual(jobs.map((_, i) => `v${i}`));
    expect(r.every((x) => x.status === "ok" && x.attempts === 1)).toBe(true);
  });
  it("defaults to 4 in parallel", async () => {
    let live = 0, peak = 0;
    await runParallel(Array.from({ length: 8 }, (_, i) => job(`s${i}`, async () => { live++; peak = Math.max(peak, live); await sleep(5); live--; return "x"; })));
    expect(peak).toBe(4);
  });
  it("isolates a failing job: the others finish and the run does not throw", async () => {
    const r = await runParallel([job("a", async () => "A"), job("b", async () => { throw new Error("boom"); }), job("c", async () => "C")], { retries: 0 });
    expect(r.map((x) => x.status)).toEqual(["ok", "failed", "ok"]);
    expect(r[1].error?.message).toBe("boom");
  });
  it("retries once by default, then reports the failure", async () => {
    let calls = 0;
    const flaky = await runParallel([job("a", async (a) => { calls++; if (a === 0) throw new Error("transient"); return "ok"; })]);
    expect(flaky[0]).toMatchObject({ status: "ok", value: "ok", attempts: 2 });
    let n = 0;
    const dead = await runParallel([job("b", async () => { n++; throw new Error("down"); })]);
    expect(dead[0]).toMatchObject({ status: "failed", attempts: 2 });
    expect(n).toBe(2);
    expect(calls).toBe(2);
  });
  it("does not retry budget, unavailable or stop errors (a retry could pay twice)", async () => {
    let n = 0;
    const e = Object.assign(new Error("over cap"), { name: "BudgetExceeded" });
    const r = await runParallel([job("a", async () => { n++; throw e; }), job("b", async () => { n++; throw new Error("Stopped by the operator"); })]);
    expect(n).toBe(2);
    expect(r.map((x) => x.attempts)).toEqual([1, 1]);
    expect(isFatal(e)).toBe(true);
    expect(isFatal(new Error("plain"))).toBe(false);
  });
  it("serves unchanged inputs from the cache with no render, and renders changed ones", async () => {
    const cache = memoryCache<string>();
    let renders = 0;
    const mk = (id: string, key: string) => job(id, async () => { renders++; return `clip-${key}`; }, key);
    const first = await runParallel([mk("a", "k1"), mk("b", "k2")], { cache });
    expect(first.map((x) => x.status)).toEqual(["ok", "ok"]);
    const second = await runParallel([mk("a", "k1"), mk("b", "k2-changed")], { cache });
    expect(second.map((x) => x.status)).toEqual(["cached", "ok"]);
    expect(renders).toBe(3);
    expect(second[0].value).toBe("clip-k1");
  });
  it("two jobs with the same input share one render", async () => {
    let renders = 0;
    const same = (id: string) => job(id, async () => { renders++; await sleep(10); return "x"; }, "same");
    const r = await runParallel([same("a"), same("b")], { cache: memoryCache<string>() });
    expect(renders).toBe(1);
    expect(r.map((x) => x.status).sort()).toEqual(["cached", "ok"]);
  });
  it("a stale cached value is re-rendered", async () => {
    const cache = memoryCache<string>();
    await cache.set("k", "gone");
    const r = await runParallel([job("a", async () => "fresh", "k")], { cache, stale: (v) => v === "gone" });
    expect(r[0]).toMatchObject({ status: "ok", value: "fresh" });
  });
  it("does not cache failures", async () => {
    const cache = memoryCache<string>();
    await runParallel([job("a", async () => { throw new Error("x"); }, "k")], { cache, retries: 0 });
    expect(cache.size()).toBe(0);
  });
  it("records a timing per job, with the parallel wall time below the summed time", async () => {
    const timings: StageTiming[] = [];
    await runParallel(Array.from({ length: 4 }, (_, i) => ({ ...job(`s${i}`, async () => { await sleep(30); return "x"; }), stage: "render", renderer: "blender" })), { timings, limit: 4 });
    expect(timings).toHaveLength(4);
    expect(timings[0]).toMatchObject({ stage: "render", renderer: "blender", status: "ok", attempts: 1 });
    const [s] = summarizeTimings(timings);
    expect(s).toMatchObject({ stage: "render", count: 4 });
    expect(s.wallMs).toBeLessThan(s.totalMs * 0.6);
  });
});

describe("cache keys", () => {
  it("hash is stable across key order and changes with any input", () => {
    expect(inputHash({ a: 1, b: [1, 2] }, "x")).toBe(inputHash({ b: [1, 2], a: 1 }, "x"));
    expect(inputHash({ a: 1 }, "x")).not.toBe(inputHash({ a: 2 }, "x"));
    expect(stable({ a: undefined, b: 1 })).toBe(stable({ b: 1 }));
  });
  it("fileCache survives a restart; a missing file is a miss", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rc-"));
    await fileCache<{ url: string }>(dir).set("abc", { url: "/api/media/x.mp4" });
    expect(await fileCache<{ url: string }>(dir).get("abc")).toEqual({ url: "/api/media/x.mp4" });
    expect(await fileCache(dir).get("nope")).toBeUndefined();
    await fs.rm(dir, { recursive: true });
  });
  it("cached() calls fn once for repeated keys", async () => {
    const c = memoryCache<number>();
    let n = 0;
    const a = await cached(c, "k", async () => ++n);
    const b = await cached(c, "k", async () => ++n);
    expect([a.hit, b.hit, b.value, n]).toEqual([false, true, 1, 1]);
  });
});

describe("timer", () => {
  it("records ok and failed steps and rethrows", async () => {
    const sink: StageTiming[] = [];
    let t = 1000;
    const tm = timer(sink, () => (t += 50));
    expect(await tm.time("plan", async () => "ok")).toBe("ok");
    await expect(tm.time("render", async () => { throw new Error("x"); }, { shotId: "s1" })).rejects.toThrow("x");
    expect(sink.map((x) => [x.stage, x.status, x.ms, x.shotId])).toEqual([["plan", "ok", 50, undefined], ["render", "failed", 50, "s1"]]);
  });
});
