import { describe, expect, it, vi } from "vitest";
import { qaGates, gateEnabled } from "@/lib/qa/config";
import { finalReview, loudnessScore, median } from "@/lib/qa/final-review";
import { checkPreviewShots } from "@/lib/qa/shot-check";
import { memoryCache } from "@/lib/render/cache";
import { stageBlock } from "@/lib/stage-policy";

const ok = { lufs: -14, peak: -2 };
const deps = (scores: number[], over: Partial<Parameters<typeof finalReview>[0]> = {}) => {
  let i = 0;
  return { review: vi.fn(async () => ({ score: scores[i++ % scores.length], notes: [`n${i}`] })), loudness: async () => ok, ocr: async () => [], sync: async () => 9, ...over };
};

describe("QA gate config", () => {
  it("consolidated by default: only the free deterministic stages and the final still gate", () => {
    const g = qaGates({});
    expect(g.mode).toBe("consolidated");
    expect(g.finalReviews).toBe(3);
    expect(g.enabled.shots).toBe(false);
    expect(g.enabled.edit).toBe(false);
    expect(g.enabled.audio).toBe(false);
    expect(g.enabled.final).toBe(true);
    expect(g.enabled.voice).toBe(true);
  });
  it("one switch restores every legacy gate", () => {
    const g = qaGates({ QA_GATES: "legacy" });
    expect(Object.values(g.enabled).every(Boolean)).toBe(true);
  });
  it("final review count is forced odd and clamped", () => {
    expect(qaGates({ QA_FINAL_REVIEWS: "4" }).finalReviews).toBe(5);
    expect(qaGates({ QA_FINAL_REVIEWS: "99" }).finalReviews).toBe(7);
    expect(qaGates({ QA_FINAL_REVIEWS: "0" }).finalReviews).toBe(3);
    expect(gateEnabled("shots", { QA_GATES: "legacy" })).toBe(true);
  });
  it("a failing disabled stage no longer blocks the flow, a failing enabled one still does", () => {
    const run = { stageScores: { "edit:d1": { stage: "edit", score: 4, pass: false, checks: [], notes: [] }, "final:d1": { stage: "final", score: 4, pass: false, checks: [], notes: [] } } } as never;
    expect(stageBlock(run, "edit", "d1")).toBeNull();
    expect(stageBlock(run, "final", "d1")).not.toBeNull();
  });
});

describe("check (c): final review", () => {
  it("is the median of 3, so one wild score does not decide", async () => {
    const r = await finalReview(deps([10, 3, 9.5]));
    expect(r.median).toBe(9.5);
    expect(r.pass).toBe(true);
    expect(r.reviews).toHaveLength(3);
  });
  it("a single bad outlier in the other direction cannot rescue a weak cut", async () => {
    const r = await finalReview(deps([10, 6, 5]));
    expect(r.median).toBe(6);
    expect(r.pass).toBe(false);
  });
  it("misspelled on-screen text caps the score whatever the reviewers said", async () => {
    const r = await finalReview(deps([10, 10, 10], { ocr: async () => [{ kind: "copy", at: 3, expected: "OLIPOP", observed: "OLIPOP read as OLLPOP", status: "fail" }] }));
    expect(r.score).toBeLessThanOrEqual(6);
    expect(r.pass).toBe(false);
    expect(r.notes.join(" ")).toMatch(/on-screen text/);
  });
  it("loud mixes and out-of-sync captions cap the score", async () => {
    expect((await finalReview(deps([10], { loudness: async () => ({ lufs: -6, peak: 1 }) }), { reviews: 1 })).score).toBeLessThanOrEqual(7);
    expect((await finalReview(deps([10], { sync: async () => 5 }), { reviews: 1 })).score).toBeLessThanOrEqual(7);
  });
  it("a reviewer that throws does not sink the run, but no majority cannot pass", async () => {
    let n = 0;
    const flaky = deps([10], { review: vi.fn(async () => { if (n++ === 0) throw new Error("boom"); return { score: 10, notes: [] }; }) });
    expect((await finalReview(flaky)).pass).toBe(true);
    const dead = deps([10], { review: async () => { throw new Error("down"); } });
    const r = await finalReview(dead);
    expect(r.pass).toBe(false);
    expect(r.notes.join(" ")).toMatch(/majority/);
  });
  it("loudness scoring", () => {
    expect(loudnessScore(ok).score).toBe(10);
    expect(loudnessScore({ lufs: -24, peak: -3 }).score).toBeLessThan(7);
    expect(loudnessScore(null).score).toBe(5);
    expect(median([1, 9, 5, 7])).toBe(6);
  });
});

describe("check (b): one cheap check per preview shot", () => {
  const shots = [{ id: "a", expected: "can on wet stone", clip: "clip-a", seconds: 3 }, { id: "b", expected: "pour into glass", clip: "clip-b", seconds: 2 }];
  it("makes exactly one model call per shot, on the mid-shot frame", async () => {
    const frame = vi.fn(async (_c: string, at: number) => `f@${at}`);
    const review = vi.fn(async (_f: string, _e: string) => ({ score: 8, notes: ["good"] }));
    const v = await checkPreviewShots(shots, { frame, review }, { cache: memoryCache() });
    expect(review).toHaveBeenCalledTimes(2);
    expect(frame).toHaveBeenCalledWith("clip-a", 1.5);
    expect(v.a.pass && v.b.pass).toBe(true);
  });
  it("does not re-judge an unchanged clip, but does when the clip changes", async () => {
    const cache = memoryCache<never>();
    const review = vi.fn(async () => ({ score: 8, notes: [] }));
    const d = { frame: async () => "f", review };
    await checkPreviewShots(shots, d, { cache: cache as never });
    const again = await checkPreviewShots(shots, d, { cache: cache as never });
    expect(review).toHaveBeenCalledTimes(2);
    expect(again.a.cached).toBe(true);
    await checkPreviewShots([{ ...shots[0], clip: "clip-a2" }], d, { cache: cache as never });
    expect(review).toHaveBeenCalledTimes(3);
  });
  it("a failing check is reported as not passed and does not stop the other shots", async () => {
    const review = vi.fn(async (_f: string, e: string) => { if (e.includes("wet")) throw new Error("vision down"); return { score: 9, notes: [] }; });
    const v = await checkPreviewShots(shots, { frame: async () => "f", review }, { cache: memoryCache() });
    expect(v.a.pass).toBe(false);
    expect(v.a.note).toMatch(/could not run/);
    expect(v.b.pass).toBe(true);
  });
});
