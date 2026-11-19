import { describe, expect, it, vi } from "vitest";
import { memoryCache } from "@/lib/render/cache";
import { paid } from "@/lib/render/cost-meter";
import type { Renderer } from "@/lib/render/types";
import { parseSheet } from "@/lib/shot-sheet";
import { newSheetRun } from "@/lib/sheet/flow";
import { renderSheetVersion, runFinal, runPreviews, type RenderDeps } from "@/lib/sheet/render";
import type { SheetRun } from "@/lib/sheet/run-types";

vi.mock("@/lib/store", async (orig) => ({ ...(await orig<typeof import("@/lib/store")>()), put: vi.fn(async () => {}), get: vi.fn(async () => null) }));

const shot = (n: number, start: number, end: number, engine: string, extra: Record<string, unknown> = {}) => ({
  id: `s${n}`, n, start, end, shotType: "CU", framing: "label", camera: { angle: "eye level", move: "slow push-in", lensMm: 85 }, subject: "can", action: `action ${n}`,
  lighting: "magenta rim", text: null, audio: { vo: null, sfx: `click ${n}, then pour`, music: null }, engine, engineLocked: true, ...extra,
});
const sheetFor = (audioMode: "vo" | "foley" = "foley", engines = ["blender", "ai_video", "remotion"]) => {
  const r = parseSheet({ version: 1, targetSec: 9, audioMode, bed: "low drone", rules: [], endCard: { title: "Brand" }, shots: engines.map((e, i) => shot(i + 1, i * 3, i * 3 + 3, e, { prompt: `prompt ${i + 1}`, ...(audioMode === "vo" ? { audio: { vo: `Line ${i + 1}`, sfx: null, music: null } } : {}) })) });
  if (!r.ok) throw new Error(r.error);
  return r.sheet;
};
const runFor = (sheet = sheetFor(), cap = 2): SheetRun => {
  const run = newSheetRun({ brandUrl: "https://x.com", goal: "g", capUsd: cap, audioMode: sheet.audioMode }, "u");
  run.sheet = sheet;
  run.gate = null;
  return run;
};

function fakes(o: { failShot?: string } = {}) {
  const calls: string[] = [];
  const mk = (id: Renderer["id"], usd: number): Renderer => ({
    id, available: async () => true, estimateUsd: () => usd,
    async render(row) {
      calls.push(`${id}:${row.id}`);
      if (row.id === o.failShot) throw new Error("provider 500");
      // like the real ai-video renderer, a paid render goes through the meter's gate
      const take = await paid(`video:${row.id}`, usd, async () => ({ url: `data:video/mp4;base64,${id}-${row.id}`, usage: { costUsd: usd } }));
      return { url: take.url, costUsd: take.usage.costUsd, note: `${id}-model` };
    },
  });
  const stitch = vi.fn(async (clips: string[], a: { sfx: unknown[] }) => ({ url: `data:video/mp4;base64,cut${clips.length}`, starts: [0, 3, 6], duration: 9, ...(a ? {} : {}) }));
  const review = vi.fn(async () => ({ score: 8, notes: ["ok"] }));
  const deps: RenderDeps = {
    renderers: { "ai-video": mk("ai-video", 0.3), blender: mk("blender", 0), remotion: mk("remotion", 0) },
    photos: async () => ["data:image/png;base64,AAAA"],
    store: async (d, key) => (d.startsWith("data:") ? `/media/${key}.mp4` : d),
    shotCheck: { frame: async (c, at) => `${c}@${at}`, review },
    stitch: stitch as never,
    voice: vi.fn(async () => ({ url: "data:audio/mpeg;base64,vo", usd: 0.05 })),
    final: () => ({ review: vi.fn(async () => ({ score: 9.5, notes: ["strong"] })), loudness: async () => ({ lufs: -14, peak: -2 }), ocr: async () => [], sync: async () => null }),
    clipCache: memoryCache(), judgeCache: memoryCache(),
  };
  return { deps, calls, stitch, review };
}

describe("previews through the render pipeline", () => {
  it("routes each shot to its engine, renders in parallel, checks each once, and tracks cost and timings on the run", async () => {
    const run = runFor();
    const f = fakes();
    const v = await runPreviews(run, f.deps);
    expect(v.status).toBe("done");
    expect(f.calls.sort()).toEqual(["ai-video:s2", "blender:s1", "remotion:s3"]);
    expect(v.shots.map((s) => s.engine)).toEqual(["blender", "ai-video", "remotion"]);
    expect(v.shots.every((s) => s.url?.startsWith("/media/"))).toBe(true);
    expect(f.review).toHaveBeenCalledTimes(3); // check 2: exactly one cheap look per shot
    expect(v.shots.every((s) => s.check?.score === 8)).toBe(true);
    expect(v.score).toBe(8);
    expect(run.cost.spentUsd).toBeCloseTo(0.3, 5); // only the paid shot
    expect(run.cost.entries).toHaveLength(1);
    expect(v.usd).toBeCloseTo(0.3, 5);
    expect(run.timings.map((t) => t.stage)).toEqual(expect.arrayContaining(["preview shot 1", "preview shot 2", "preview shot 3", "shot checks", "edit and mix"]));
    expect(run.step).toBe("previews");
  });

  it("foley mode plans a sound per sheet action and no voice; vo mode makes the voice", async () => {
    const foley = fakes();
    await runPreviews(runFor(sheetFor("foley")), foley.deps);
    const a = foley.stitch.mock.calls[0][1] as { sfx: { kind: string }[]; voices: unknown[]; duck: boolean };
    expect(a.voices).toHaveLength(0);
    expect(a.sfx.filter((c) => c.kind === "click")).toHaveLength(3);
    expect(a.duck).toBe(true);
    const vo = fakes();
    const run = runFor(sheetFor("vo"));
    await runPreviews(run, vo.deps);
    expect(vo.deps.voice).toHaveBeenCalledTimes(3);
    expect((vo.stitch.mock.calls[0][1] as { voices: unknown[] }).voices).toHaveLength(3);
  });

  it("an unchanged sheet is not re-rendered and not re-judged", async () => {
    const f = fakes();
    await runPreviews(runFor(), f.deps);
    const again = runFor();
    const v = await runPreviews(again, f.deps);
    expect(f.calls).toHaveLength(3);
    expect(f.review).toHaveBeenCalledTimes(3);
    expect(v.shots.every((s) => s.cached)).toBe(true);
    expect(again.cost.spentUsd).toBe(0);
  });

  it("changing one shot re-renders only that shot", async () => {
    const f = fakes();
    await runPreviews(runFor(), f.deps);
    const edited = sheetFor();
    edited.shots[1].prompt = "a different prompt";
    await runPreviews(runFor(edited), f.deps);
    expect(f.calls.filter((c) => c.startsWith("ai-video"))).toHaveLength(2);
    expect(f.calls).toHaveLength(4);
  });

  it("refuses before spending when the paid shots do not fit the remaining cap", async () => {
    const run = runFor(sheetFor(), 0.1);
    const f = fakes();
    const v = await runPreviews(run, f.deps);
    expect(v.status).toBe("refused");
    expect(v.estimate?.blocked[0]).toMatch(/cap/);
    expect(f.calls).toHaveLength(0);
    expect(run.cost.spentUsd).toBe(0);
  });

  it("a failing shot is retried once, never stops the others, and the rest are kept", async () => {
    const run = runFor();
    const f = fakes({ failShot: "s2" });
    const v = await runPreviews(run, f.deps);
    expect(v.status).toBe("failed");
    expect(v.error).toMatch(/s2/);
    expect(f.calls.filter((c) => c === "ai-video:s2")).toHaveLength(2);
    expect(v.shots[0].url).toBeTruthy();
    expect(v.shots[2].url).toBeTruthy();
    expect(f.stitch).not.toHaveBeenCalled();
    expect(run.cost.spentUsd).toBe(0); // the failed paid call released its hold
  });

  it("a mid-run cap stops the paid shot server side even when the preflight passed", async () => {
    const run = runFor(sheetFor(), 0.35);
    const f = fakes();
    const v = await runPreviews(run, f.deps);
    expect(v.status).toBe("done");
    expect(run.cost.spentUsd).toBeLessThanOrEqual(0.35);
  });

  it("will not render a sheet the gate rejected", async () => {
    const run = runFor();
    run.gate = { pass: false, issues: [{ level: "error", text: "x" }] } as never;
    await expect(renderSheetVersion(run, fakes().deps, { tier: "preview" })).rejects.toThrow(/gate/);
  });
});

describe("final through the render pipeline", () => {
  it("renders at final quality and ends with the strict review (median of 3, no per-shot checks)", async () => {
    const run = runFor();
    const f = fakes();
    const out = await runFinal(run, f.deps);
    expect(out).toMatchObject({ score: 9.5 });
    expect(out!.reviews).toHaveLength(3);
    expect(f.review).not.toHaveBeenCalled();
    expect(run.step).toBe("final");
    expect(run.timings.some((t) => t.stage === "final review" && /median of 3/.test(t.note ?? ""))).toBe(true);
    expect(run.final?.videoUrl).toMatch(/^\/media\//);
  });
});
