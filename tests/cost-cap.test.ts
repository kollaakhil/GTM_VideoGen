import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/studio/route";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SCRIPT_RUBRIC } from "@/lib/quality-policy";
import type { AdScript, Creative, ShotQA, StudioRun } from "@/lib/types";
import { VOICE_MODEL } from "@/lib/ai";

const state = vi.hoisted(() => ({
  run: null as StudioRun | null,
  creative: null as Creative | null,
  jobs: [] as Array<() => Promise<void>>,
  review: vi.fn(),
  vision: vi.fn(),
  render: vi.fn(),
  upscale: vi.fn(),
}));

vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: (job: () => Promise<void>) => state.jobs.push(job) }));
vi.mock("@/lib/session", () => ({ currentUser: async () => "fixture@gtm.dev" }));
vi.mock("@/lib/store", () => ({
  get: async (table: string) => table === "studio_runs" ? structuredClone(state.run) : table === "creatives" ? structuredClone(state.creative) : null,
  newId: (prefix: string) => `${prefix}-fixture`,
  list: async () => [],
  put: async (table: string, row: StudioRun | Creative) => {
    if (table === "studio_runs") state.run = structuredClone(row) as StudioRun;
    if (table === "creatives") state.creative = structuredClone(row) as Creative;
  },
  mediaDataUrl: async (url: string) => url,
  mediaFile: vi.fn(),
  storeMedia: async (url: string) => url,
}));
vi.mock("@/lib/ai", async (original) => ({
  ...await original<typeof import("@/lib/ai")>(), chatJSON: state.vision, generateVideo: state.render,
  audioConfigured: () => true, openrouterCredits: async () => 10, videoDurations: async () => [3], videoPricePerSec: async () => 0.01,
}));
vi.mock("@/lib/script-lab", async (original) => ({ ...await original<typeof import("@/lib/script-lab")>(), reviewScript: state.review }));
vi.mock("@/lib/gate", async (original) => ({
  ...await original<typeof import("@/lib/gate")>(), claimsCheck: async () => ({ data: { unsupported: [], missing: [] }, cost: 0 }),
}));
vi.mock("@/lib/pipeline", async (original) => ({
  ...await original<typeof import("@/lib/pipeline")>(), qa: async () => ({ data: { score: 9, pass: true, notes: [] }, cost: 0 }),
}));
vi.mock("@/lib/media-qa", async (original) => ({
  ...await original<typeof import("@/lib/media-qa")>(),
  audioFindings: async () => [], checkExport: async () => [], evidenceFrames: async () => [{ at: 0, url: "fixture-frame" }],
  localOcrAvailable: async () => true, verifySpeech: async () => ({ findings: [], cost: 0 }), videoTechnicalFindings: async () => [],
}));
vi.mock("@/lib/upscale", () => ({ upscaleClip: state.upscale, upscalerAvailable: async () => true }));
vi.mock("@/lib/qa-tools", () => ({ sceneCuts: async () => ({ cuts: [], via: "ffmpeg" }), wordTimings: async () => null, werCheck: async () => ({ wer: 0, via: "builtin" }), lipSync: async () => null, loudness: async () => null }));
vi.mock("@/lib/video-post", async (original) => ({
  ...await original<typeof import("@/lib/video-post")>(),
  captionVariants: async () => [{ aspect: "9:16", url: "fixture-export" }],
  stitchShots: async () => ({ url: "fixture-edit", starts: [0, 3], duration: 6 }),
}));


process.env.RENDER_CACHE = "1";
const freshCacheDir = () => { process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gtm-par-")); };
freshCacheDir();

const beats = [1, 2, 3, 4].map((n) => ({ seconds: 3, visual: `Visual ${n}`, vo: `Line ${n}.`, onScreen: `Text ${n}` }));
const fixture: AdScript = {
  id: "sc_par", framework: "Hook → story → offer", hook: { spoken: "Line 1.", onScreen: "Text 1", visual: "Visual 1" }, beats, cta: "Shop now",
  review: { rubric: SCRIPT_RUBRIC, writer: "w", judge: "j", targetSeconds: 12 }, checks: [],
  score: { overall: 9, scores: {}, unsupported: [], notes: [], panel: { stopRate: 9, quotes: [] } },
};
const request = (action: string, data: Record<string, unknown> = {}) =>
  POST(new Request("http://localhost/api/studio", { method: "POST", body: JSON.stringify({ action, runId: "test", directionId: "dir", ...data }) }));
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
const pass: ShotQA = { score: 9, match: "pass", notes: [], frames: [{ at: 0, match: "pass", note: "" }] };

function freshRun() {
  const model = "fixture-model";
  state.run = {
    id: "test", status: "idle", stage: "qa", format: "video", brandUrl: "https://example.com", progress: {}, events: [], costUsd: 0, creativeIds: [],
    brief: { objective: "Sell" }, research: { brand: "Example" }, models: { text: "text", image: "image", video: model, vision: "vision" },
    videoPlan: { category: "product_demo", lengthSec: 12, draftModel: model, finalModel: model, voice: "Rachel", music: false, budgetUsd: 5, candidates: 1 },
    directions: [{ id: "dir", title: "F", format: "video", scripts: [fixture], approvedScript: fixture, storyboardKey: "sb", productRefs: ["fixture-product"],
      shots: beats.map((b, i) => ({
        ...b, id: `s${i}`, beat: i ? "cta" : "hook", camera: "wide", status: "keyframe", attempts: 0, keyframe: `kf-${i}`, keyframeQa: pass, expectedVisual: b.visual,
        voiceTrack: { key: hash([VOICE_MODEL, b.vo, "Rachel", b.seconds]), url: `voice-${i}` },
      })) }],
  } as unknown as StudioRun;
}

beforeEach(() => {
  vi.resetAllMocks();
  state.jobs = [];
  state.creative = null;
  freshRun();
  freshCacheDir();
  state.vision.mockResolvedValue({ data: { score: 9, notes: [], frames: [{ index: 1, match: "pass", note: "" }] }, usage: { costUsd: 0 } });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));


describe("run cap on the server", () => {
  it("set_cap saves the cap on the run and reports it in the meter", async () => {
    const res = await request("set_cap", { capUsd: 7.5 });
    expect(res.status).toBe(200);
    expect(state.run!.capUsd).toBe(7.5);
    expect(state.run!.meter).toMatchObject({ capUsd: 7.5, spentUsd: 0, remainingUsd: 7.5 });
    expect((await request("set_cap", { capUsd: 0.1 })).status).toBe(400);
    expect((await request("set_cap", { capUsd: 9999 })).status).toBe(400);
  });

  it("a job starts with the default $2 cap and leaves the final meter on the run", async () => {
    state.render.mockResolvedValue({ url: "clip", usage: { costUsd: 0.03 } });
    expect((await request("render_video", { tier: "draft" })).status).toBe(200);
    expect(state.run!.meter).toMatchObject({ capUsd: 2 });
    await state.jobs[0]();
    expect(state.run!.meter).toMatchObject({ capUsd: 2, reservedUsd: 0 });
  });

  it("preflight refuses a take that the run's remaining cap cannot cover, before any provider call", async () => {
    state.run!.capUsd = 0.1;
    state.run!.costUsd = 0.05;
    expect((await request("render_video", { tier: "draft" })).status).toBe(200);
    await state.jobs[0]();
    expect(state.run!.status).toBe("error");
    expect(state.run!.failure?.message).toMatch(/run cap is left/);
    expect(state.render).not.toHaveBeenCalled();
  });
});
