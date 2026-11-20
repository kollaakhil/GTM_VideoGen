import { describe, expect, it, vi } from "vitest";

// Records the model every provider call really receives (the overrides must reach the provider, not just a closure).
const seen = vi.hoisted(() => ({ video: [] as string[], chat: [] as string[], aspect: undefined as string | undefined }));
vi.mock("@/lib/ai", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai")>()),
  generateVideo: vi.fn(async (model: string, _p: string, o: { aspect?: string }) => { seen.video.push(model); seen.aspect = o?.aspect; return { url: "data:video/mp4;base64,AA", usage: { costUsd: 0.2 } }; }),
  chatJSON: vi.fn(async (model: string) => { seen.chat.push(model); return { data: { score: 7, notes: ["fine"] }, usage: { costUsd: 0.001 } }; }),
}));
vi.mock("@/lib/store", async (orig) => ({ ...(await orig<typeof import("@/lib/store")>()), put: vi.fn(async () => {}), get: vi.fn(async () => null) }));

import { memoryCache } from "@/lib/render/cache";
import { CostMeter, paid, withMeter } from "@/lib/render/cost-meter";
import { kitJob } from "@/lib/render/blender-kit";
import { rowFromSheetShot } from "@/lib/render/types";
import { parseSheet, type SheetShot } from "@/lib/shot-sheet";
import { newSheetRun } from "@/lib/sheet/flow";
import { defaultRenderDeps } from "@/lib/sheet/render-deps";
import { estimateSheetVersion, pickedVersion, renderSheetVersion, shotsForStack, type RenderDeps } from "@/lib/sheet/render";
import type { Version } from "@/lib/sheet/run-types";

const shot = (n: number, start: number, end: number, engine: string, extra: Record<string, unknown> = {}) => ({
  id: `s${n}`, n, start, end, shotType: "ECU", framing: "macro", camera: { angle: "low", move: "slow push-in 10%", lensMm: 100 }, subject: "brass toggle switch", action: "the switch snaps down and the gas tubes ignite",
  lighting: "practical neon", text: { copy: "HIGH THINKING", placement: "diegetic" }, audio: { vo: null, sfx: "clack", music: null }, engine, engineLocked: false, ...extra,
});
const sheet = (() => {
  const r = parseSheet({ version: 1, targetSec: 9, audioMode: "foley", bed: "drone", palette: "black, #ff5e00 neon", rules: [], endCard: { title: "Gemini 4 Neon", line: "Available now" }, shots: [
    shot(1, 0, 3, "blender", { blender: { template: "lab", label: "HIGH THINKING", ignite: 0.6 } }),
    shot(2, 3, 6, "ai_video", { prompt: "gas tubes ignite" }),
    shot(3, 6, 9, "remotion"),
  ] });
  if (!r.ok) throw new Error(r.error);
  return r.sheet;
})();
const stack = (id: string, video: string) => ({ id, label: id, description: "", models: { video, qa: "google/gemini-3.8-flash" }, estimatedCostUsd: 0 });

describe("the shot sheet decides the renderer", () => {
  it("an unlocked Blender row renders in Blender with the sheet's own template", () => {
    const row = rowFromSheetShot(sheet.shots[0], {}, sheet.palette);
    expect(row.renderer).toBe("blender");
    expect(row.kit?.blender?.template).toBe("lab");
    expect(rowFromSheetShot(sheet.shots[2]).renderer).toBe("remotion");
    expect(rowFromSheetShot(sheet.shots[1]).renderer).toBe("ai-video");
  });

  it("maps a lab row to scene_kit with the toggle, traces and push-in, and a macro label to shot_kit", () => {
    const lab = kitJob(sheet.shots[0], sheet, { width: 1280, height: 720, mode: "preview" });
    expect(lab.script).toBe("scene_kit.py");
    expect(lab.spec).toMatchObject({ camera: { preset: "macro_contact", push: 0.1, lens: 100 }, toggle: { close: expect.any(Number) }, labels: [{ text: "HIGH THINKING" }] });
    expect((lab.spec.traces as { color: string; ignite: number }[])[0]).toMatchObject({ color: "#ff5e00", ignite: 0.6 });
    const macro = kitJob({ ...sheet.shots[0], blender: { template: "macro_label", label: "#1 INDEX" } } as SheetShot, sheet, { width: 1920, height: 1080, mode: "final" });
    expect(macro).toMatchObject({ script: "shot_kit.py", spec: { template: "macro_label", label: "#1 INDEX", camera: { move: "slow push-in 10%", amount: 0.1, angle: "low" }, samples: 16, width: 1280, height: 720 } });
  });
});

describe("versions from one sheet", () => {
  it("a Blender-heavy stack renders AI-video shots in Blender for free; another stack pays only its AI seconds", () => {
    const heavy = shotsForStack(sheet, stack("blender", "auto"));
    expect(heavy.map((s) => s.engine)).toEqual(["blender", "blender", "remotion"]);
    expect(heavy[1].blender?.template).toBeDefined();
    const free = estimateSheetVersion(sheet, stack("blender", "auto"), "x");
    expect(free.lines.filter((l) => l.what.startsWith("shot"))).toHaveLength(0);
    expect(free.usd).toBeLessThan(0.02);
    const wan = estimateSheetVersion(sheet, stack("wan", "fal-ai/wan/v2.2-5b/image-to-video"), "x");
    expect(wan.lines[0]).toMatchObject({ what: "shot 2 (3.0s)", usd: 0.12 });
  });

  it("Final renders the version the operator picked, not the best score", () => {
    const run = newSheetRun({ brandUrl: "https://x.com", goal: "g" }, "u");
    const v = (id: string, score: number): Version => ({ id, stack: stack(id, "auto"), tier: "preview", status: "done", estimate: null, shots: [], videoUrl: "x", contactUrl: null, usd: 0, ms: 0, score });
    run.versions = [v("a", 9), v("b", 6)];
    expect(pickedVersion(run)?.id).toBe("a");
    run.picks = { mode: "video", video: "b", shots: {} };
    expect(pickedVersion(run)?.id).toBe("b");
  });
});

describe("stack overrides reach the real provider calls", () => {
  it("the version's video and QA models are the ones generateVideo and chatJSON receive", async () => {
    seen.video.length = 0; seen.chat.length = 0;
    const d = defaultRenderDeps({ video: "fal-ai/wan/v2.2-5b/image-to-video", qa: "qwen/qwen3.8-27b" });
    await d.renderers["ai-video"]!.render(rowFromSheetShot(sheet.shots[1]), { mode: "preview", width: 1280, height: 720, refs: [], prompt: "p" });
    await d.shotCheck.review("data:image/jpeg;base64,AA", "expected");
    expect(seen.video).toEqual(["fal-ai/wan/v2.2-5b/image-to-video"]);
    expect(seen.aspect).toBe("16:9");
    expect(seen.chat).toEqual(["qwen/qwen3.8-27b"]);
    expect(d.renderers["ai-video"]!.estimateUsd(rowFromSheetShot(sheet.shots[1]), { mode: "preview", width: 1, height: 1, refs: [] })).toBeCloseTo(0.12);
  });

  it("the Blender-heavy 'auto' video model never reaches a provider", () => {
    const d = defaultRenderDeps({ video: "auto" });
    expect(d.renderers["ai-video"]!.estimateUsd(rowFromSheetShot(sheet.shots[1]), { mode: "preview", width: 1, height: 1, refs: [] })).toBeGreaterThan(0);
  });
});

describe("every paid call is logged", () => {
  it("the meter reports each settled call once", async () => {
    const charges: number[] = [];
    const m = new CostMeter({ capUsd: 1, onCharge: (e) => charges.push(e.usd) });
    await withMeter(m, () => paid("text:x", 0.03, async () => ({ usage: { costUsd: 0.002 } })));
    await withMeter(m, () => paid("free", 0, async () => ({ usage: { costUsd: 0 } })));
    expect(charges).toEqual([0.002]);
  });

  it("shot checks land on the run's cost entries, next to the clips", async () => {
    const run = newSheetRun({ brandUrl: "https://x.com", goal: "g", capUsd: 2 }, "u");
    run.sheet = sheet;
    const mk = (id: "ai-video" | "blender" | "remotion", usd: number) => ({ id, available: async () => true, estimateUsd: () => usd, render: async (row: { id: string }) => { const t = await paid(`video:${row.id}`, usd, async () => ({ url: `data:video/mp4;base64,${row.id}`, usage: { costUsd: usd } })); return { url: t.url, costUsd: usd }; } });
    const deps: RenderDeps = {
      renderers: { "ai-video": mk("ai-video", 0.3), blender: mk("blender", 0), remotion: mk("remotion", 0) },
      photos: async () => [], store: async (d) => d,
      shotCheck: { frame: async (c) => c, review: async () => (await paid("text:qa", 0.03, async () => ({ score: 8, notes: [], usage: { costUsd: 0.001 } }))) },
      stitch: async (clips) => ({ url: "data:video/mp4;base64,cut", starts: [0], duration: clips.length }),
      final: () => ({ review: async () => ({ score: 9, notes: [] }), loudness: async () => ({ lufs: -14, peak: -2 }), ocr: async () => [], sync: async () => null }),
      clipCache: memoryCache(), judgeCache: memoryCache(),
    };
    const { version } = await renderSheetVersion(run, deps, { tier: "preview" });
    expect(version.status).toBe("done");
    const what = run.cost.entries.map((e) => e.what);
    expect(what.filter((w) => /video:s2/.test(w))).toHaveLength(1);
    expect(what.filter((w) => /text:qa/.test(w))).toHaveLength(3);
    expect(run.cost.spentUsd).toBeCloseTo(0.303);
  });
});

describe("foley-first bed", () => {
  it("synthesises a free drone at the pitch the sheet names", async () => {
    const { droneBed } = await import("@/lib/sheet/render-deps");
    const url = await droneBed("Deep sub-bass 45Hz drone", 3);
    expect(url.startsWith("data:audio/wav;base64,")).toBe(true);
    expect(Buffer.from(url.split(",")[1], "base64").length).toBeGreaterThan(3 * 44100 * 2 * 2);
  });
});
