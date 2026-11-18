import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/studio/route";
import { PATCH } from "@/app/api/creatives/route";
import { createHash } from "node:crypto";
import { reviewShotFrames } from "@/lib/video-plan";
import { SCRIPT_RUBRIC } from "@/lib/quality-policy";
import type { AdScript, Creative, Shot, ShotQA, StudioRun } from "@/lib/types";

const state = vi.hoisted(() => ({
  run: null as StudioRun | null,
  creative: null as Creative | null,
  jobs: [] as Array<() => Promise<void>>,
  review: vi.fn(),
  vision: vi.fn(),
  render: vi.fn(),
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
vi.mock("@/lib/video-post", async (original) => ({
  ...await original<typeof import("@/lib/video-post")>(),
  captionVariants: async () => [{ aspect: "9:16", url: "fixture-export" }],
  stitchShots: async () => ({ url: "fixture-edit", starts: [0, 3], duration: 6 }),
}));

const fixture: AdScript = {
  id: "sc_hook_story_offer_fixture",
  framework: "Hook → story → offer",
  hook: { spoken: "Open the blue box.", onScreen: "The blue box", visual: "Open a blue box" },
  beats: [
    { seconds: 3, visual: "Open a blue box", vo: "Open the blue box.", onScreen: "The blue box" },
    { seconds: 3, visual: "Hold the product against the box", vo: "Shop now.", onScreen: "Shop now" },
  ],
  cta: "Shop now",
  review: { rubric: SCRIPT_RUBRIC, writer: "google/gemini-4-carbon", judge: "openai/gpt-6.1-sol", targetSeconds: 6 },
  checks: [],
  score: { overall: 9, scores: {}, unsupported: [], notes: [], panel: { stopRate: 9, quotes: [] } },
};

const request = (action: string, data: Record<string, unknown> = {}) =>
  POST(new Request("http://localhost/api/studio", { method: "POST", body: JSON.stringify({ action, runId: "test", directionId: "dir", ...data }) }));

beforeEach(() => {
  vi.resetAllMocks();
  state.jobs = [];
  state.creative = null;
  state.run = {
    id: "test", status: "idle", stage: "qa", format: "video", brandUrl: "https://example.com", progress: {}, events: [], costUsd: 0, creativeIds: [],
    brief: { objective: "Sell the product" }, research: { brand: "Example" },
    directions: [{ id: "dir", title: "Fixture", format: "video", scripts: [fixture], approvedScript: fixture,
      storyboardKey: "sb-lock", shots: [{ id: "s0", keyframe: "/api/media/fixture.jpg" }] }],
    videoPlan: { lengthSec: 6 },
  } as unknown as StudioRun;
});

describe("Studio no-spend route checks", () => {
  it("rejects HD before any video work when the current draft has not passed", async () => {
    const res = await request("render_video", { tier: "final" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("Pass draft QA") });
    expect(state.jobs).toHaveLength(0);
    expect(state.render).not.toHaveBeenCalled();
  });

  it("removes a stale approval and storyboard when independently regrading edits stays below 9", async () => {
    state.review.mockImplementation(async (script: AdScript) => ({
      script: { ...script, review: fixture.review, score: { ...fixture.score, overall: 8 } }, cost: 0,
    }));
    const res = await request("approve_script", {
      scriptId: fixture.id, edit: { beats: [{ vo: "Open your blue box.", onScreen: "The blue box" }] },
    });
    expect(res.status).toBe(200);
    await state.jobs[0]();
    expect(state.review.mock.calls[0][0].score).toBeUndefined();
    expect(state.review.mock.calls[0].slice(2)).toEqual([fixture.review!.writer, fixture.review!.judge]);
    expect(state.run!.directions[0]).toMatchObject({ approvedScript: null, storyboardKey: null });
    expect(state.run!.events.at(-1)?.text).toContain("Script not approved.");
    expect(state.render).not.toHaveBeenCalled();
  });

  it("persists the wrong-product verdict at the affected frame, independent of craft score", async () => {
    state.vision.mockResolvedValueOnce({ data: { score: 10, notes: [], frames: [
      { index: 1, match: "pass", note: "" },
      { index: 2, match: "fail", note: "Red box instead of approved blue box", repair: "source" },
    ] }, usage: { costUsd: 0 } });
    const shot = { visual: "Open a box", expectedVisual: "Open the blue box", beat: "hook" } as Shot;
    const review = await reviewShotFrames("vision", [{ at: 0.1, url: "fixture-a" }, { at: 1.5, url: "fixture-b" }], shot, ["fixture-product"]);
    expect(review.qa).toMatchObject({ score: 10, match: "fail", frames: [{ at: 0.1, match: "pass" }, { at: 1.5, match: "fail", repair: "source" }] });
    expect(JSON.stringify(state.vision.mock.calls[0])).toContain("fixture-product");
  });

  it("repairs only the failed take, reuses the voice tracks and saves a draft that unlocks HD", async () => {
    const run = state.run!, d = run.directions[0], model = "fixture-model";
    const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
    const pass: ShotQA = { score: 9, match: "pass", notes: [], frames: [{ at: 0, match: "pass", note: "" }] };
    run.models = { text: "text", image: "image", video: model, vision: "vision" };
    run.videoPlan = { category: "product_demo", lengthSec: 6, draftModel: model, finalModel: model, voice: "Rachel", music: false, budgetUsd: 1 };
    d.productRefs = ["fixture-product"];
    d.shots = fixture.beats.map((b, i) => {
      const keyframe = `fixture-keyframe-${i}`;
      return {
        ...b, id: `s${i}`, beat: i ? "cta" : "hook", camera: "wide", status: "done", attempts: 1, keyframe, keyframeQa: pass,
        expectedVisual: b.visual, clip: `saved-take-${i}`, clipModel: model,
        clipKey: hash(["video-qa-v1", "480p", model, "product_demo", d.productRefs, keyframe, b.visual, b.visual, "wide", b.seconds]),
        clipQa: i ? { score: 5, match: "fail", notes: ["Wrong box"] } : pass,
        voiceTrack: { key: hash([b.vo, "Rachel", b.seconds]), url: `saved-voice-${i}` },
      };
    });
    state.vision.mockResolvedValue({ data: { score: 9, notes: [], frames: [{ index: 1, match: "pass", note: "" }] }, usage: { costUsd: 0 } });
    state.render.mockResolvedValueOnce({ url: "repaired-take", usage: { costUsd: 0 } });
    expect((await request("render_video", { tier: "draft" })).status).toBe(200);
    await state.jobs[0]();
    expect(state.render).toHaveBeenCalledTimes(1);
    expect(state.render.mock.calls[0][1]).toContain("Wrong box");
    expect(state.run?.directions[0].shots?.map((s) => [s.clip, s.voiceTrack?.url])).toEqual([
      ["saved-take-0", "saved-voice-0"], ["repaired-take", "saved-voice-1"],
    ]);
    expect(state.run?.directions[0].passingDraft).toBe("sb-lock");
    expect(state.creative?.quality).toMatchObject({ status: "pass", tier: "draft" });

    state.creative!.quality!.tier = "final";
    state.creative!.quality!.aspects = ["9:16", "4:5", "1:1"];
    state.creative!.gate!.pass = true;
    state.run!.directions[0].storyboardKey = "sb-changed";
    const decision = await PATCH(new Request("http://localhost/api/creatives", {
      method: "PATCH", body: JSON.stringify({ action: "approve", id: state.creative!.id }),
    }));
    expect(decision.status).toBe(400);
    expect(await decision.json()).toMatchObject({ error: expect.stringContaining("storyboard changed") });
  });
});
