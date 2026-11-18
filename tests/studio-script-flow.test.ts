import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/studio/route";
import { HOOK_SECONDS, storyWindows, WRITER } from "@/lib/script-lab";
import { scriptProductionBlockers, scriptReady } from "@/lib/quality-policy";
import type { StudioRun } from "@/lib/types";
import { brief, direction, proof, reference, research } from "./fixtures/script-proof";

const mocks = vi.hoisted(() => ({
  after: vi.fn(), get: vi.fn(), put: vi.fn(), list: vi.fn(), chatJSON: vi.fn(), generateImage: vi.fn(),
  storeMedia: vi.fn(), mediaDataUrl: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({ ...await importOriginal<object>(), after: mocks.after }));
vi.mock("@/lib/session", () => ({ currentUser: async () => "test-user" }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => true }));
vi.mock("@/lib/store", async (importOriginal) => ({
  ...await importOriginal<object>(), get: mocks.get, put: mocks.put, list: mocks.list,
  storeMedia: mocks.storeMedia, mediaDataUrl: mocks.mediaDataUrl,
}));
vi.mock("@/lib/ai", async (importOriginal) => ({ ...await importOriginal<object>(), chatJSON: mocks.chatJSON, generateImage: mocks.generateImage }));

let run: StudioRun;
const options = { runId: "run-1", directionId: direction.id, lengthSec: 15 };
const send = (action: string, fields = {}) => POST(new Request("http://test/api/studio", {
  method: "POST", body: JSON.stringify({ action, ...options, ...fields }),
}));
const finish = async () => {
  const work = mocks.after.mock.lastCall?.[0];
  expect(work).toBeTypeOf("function");
  await work();
};
const result = (data: object) => ({ data, usage: { costUsd: 0.01 } });
const scoreFields = Object.fromEntries(["hook", "clarity", "specificity", "customerLanguage", "emotion", "productEarly", "cta", "pacing", "claims"].map((k) => [k, 9]));
const scriptId = (prompt: string) => JSON.parse(prompt.split("Scripts:\n")[1].split("\nScore")[0])[0].id;

beforeEach(() => {
  vi.resetAllMocks();
  run = {
    id: "run-1", brandUrl: "https://example.com/haldi", goal: brief.objective, format: "video",
    models: { text: "text", image: "image", video: "video", vision: "vision" },
    stage: "generate", status: "idle", activity: null, events: [], progress: {}, research, brief,
    directions: [structuredClone(direction)], creativeIds: [], costUsd: 0,
    createdBy: "test-user", createdAt: "2026-01-01", updatedAt: "2026-01-01",
  };
  mocks.get.mockImplementation((table) => table === "studio_runs" ? structuredClone(run) : null);
  mocks.put.mockImplementation((table, row) => { if (table === "studio_runs") run = structuredClone(row); });
  mocks.list.mockResolvedValue([]);
  mocks.storeMedia.mockImplementation(async (photo: string, key: string) => photo.startsWith("data:") ? `/api/media/${key}.jpg` : photo);
  mocks.mediaDataUrl.mockImplementation(async (photo: string) => photo.startsWith("data:") ? photo : "data:image/jpeg;base64,AA==");
});

describe("Studio script story flow (no providers)", () => {
  it("rejects an ungrounded brief and won't skip Hook Lab", async () => {
    expect((await send("write_scripts", { hookId: "e1f6bb20-ad14-49f0-a897-78cd2570a400" })).status).toBe(400);
    expect((await send("draft_hooks", { proof: { ...proof, claim: "Free expedited shipping" } })).status).toBe(400);
    expect((await send("draft_hooks", { proof: { ...proof, quoteIndex: 0 } })).status).toBe(400);
    expect((await send("draft_hooks", { proof: { ...proof, asset: "http://example.com/haldi.jpg" } })).status).toBe(400);
    expect(mocks.chatJSON).not.toHaveBeenCalled();
  });

  it("ranks three openings, blocks a high-scoring claim, and only drafts from the chosen opening", async () => {
    mocks.chatJSON.mockResolvedValueOnce(result({ hooks: [
      { type: "goal", ...reference.hook },
      { type: "friction", visual: "A closet crowded with old décor.", spoken: "I need space for Haldi.", onScreen: "No room for more décor" },
      { type: "proof", visual: "Host grips a shipping box.", spoken: "It ships tomorrow, guaranteed!", onScreen: "Haldi by tomorrow" },
    ] })).mockImplementationOnce((_model, _sys, prompt: string) => {
      const hooks = JSON.parse(prompt.split("Openings: ")[1].split("\nScore")[0]) as { id: string; type: string }[];
      return result({ reviews: hooks.map((h, i) => ({
        id: h.id, score: [9, 8, 10][i], note: "Review", blockers: h.type === "proof" ? ["Shipping guarantee isn't supported."] : [],
      })) });
    });
    expect((await send("draft_hooks", { proof: { ...proof, asset: undefined } })).status).toBe(200);
    await finish();
    const lab = run.directions[0].hookLab!;
    expect(lab.brief).toEqual({ ...proof, asset: undefined });
    expect(mocks.chatJSON.mock.calls[0][2]).toContain("The action is a proposed scene, not existing footage");
    expect(lab.hooks.map((h) => h.type)).toEqual(["goal", "friction", "proof"]);
    expect(run.directions[0].scripts).toBeUndefined();
    expect((await send("write_scripts", { hookId: lab.hooks[2].id })).status).toBe(400);
    expect((await send("write_scripts", { hookId: lab.hooks[0].id, lengthSec: 20 })).status).toBe(400);
    expect(mocks.chatJSON).toHaveBeenCalledTimes(2);

    mocks.chatJSON.mockResolvedValueOnce(result({ beats: reference.beats.slice(1) }))
      .mockImplementationOnce((_m, _s, prompt: string) => result({ scores: [{
        id: scriptId(prompt), overall: 9.6, scores: scoreFields, notes: ["Promise a specific plan."],
        blockerBeat: 2, proofProblems: ["Missing a clear plan."], unsupported: [],
      }] }))
      .mockResolvedValueOnce(result({ ...reference.beats[1], vo: "I won't buy it. I'll rent the kit." }))
      .mockImplementationOnce((_m, _s, prompt: string) => result({ scores: [{
        id: scriptId(prompt), overall: 5, scores: scoreFields, notes: [], proofProblems: [], unsupported: [],
      }] }));
    expect((await send("write_scripts", { hookId: lab.hooks[0].id })).status).toBe(200);
    await finish();
    const script = run.directions[0].scripts![0];
    expect(run.directions[0].hookLab?.selectedId).toBe(lab.hooks[0].id);
    expect(script.hook).toEqual(reference.hook);
    expect(script.beats[0]).toEqual(reference.beats[0]);
    expect(script.beats[1].vo).toBe("I won't buy it. I'll rent the kit.");
    expect(script.beats.slice(2)).toEqual(reference.beats.slice(2));
    expect(mocks.chatJSON.mock.calls[2][0]).toBe(WRITER);
    expect(mocks.chatJSON.mock.calls[3][0]).not.toBe(WRITER);
    expect(script.score?.overall).toBe(5);
    expect(scriptReady(script)).toBe(true);
    const plan = { category: "product_demo", lengthSec: 15 };
    const beforeApproval = await send("storyboard", { plan });
    expect(beforeApproval.status).toBe(400);
    expect((await beforeApproval.json()).error).toContain("Approve a video script");
    expect((await send("approve_script", { scriptId: script.id })).status).toBe(200);
    await finish();
    expect(run.directions[0].approvedScript?.id).toBe(script.id);

    const wrongDuration = await send("storyboard", { plan: { ...plan, lengthSec: 10 } });
    expect(wrongDuration.status).toBe(400);
    expect((await wrongDuration.json()).error).toContain("No script is approved for 10s.");
    expect(run.videoPlan).toBeUndefined();

    const noPhotos = await send("storyboard", { plan });
    expect(noPhotos.status).toBe(400);
    expect((await noPhotos.json()).error).toContain("Add a real product photo");
    expect(mocks.chatJSON).toHaveBeenCalledTimes(6);

    mocks.list.mockImplementation((table) => table === "brands" ? [{ url: run.brandUrl, photos: ["/api/media/brand/haldi.jpg"] }] : []);
    mocks.chatJSON.mockResolvedValueOnce(result({ shots: [] })).mockResolvedValue(result({
      score: 9, notes: [], frames: [{ index: 1, match: "pass", note: "" }],
    }));
    mocks.generateImage.mockResolvedValue({ url: "/api/media/run-1/mock-keyframe.jpg", usage: { costUsd: 0 } });
    run.directions.push({ ...direction, id: "other", approvedScript: { ...script, review: { ...script.review!, targetSeconds: 10 } } });
    expect((await send("storyboard", { plan })).status).toBe(200);
    await finish();
    expect(run.status).toBe("idle");
    expect(run.directions[0].shots?.map(({ seconds, vo, onScreen }) => ({ seconds, vo, onScreen })))
      .toEqual(script.beats.map(({ seconds, vo, onScreen }) => ({ seconds, vo, onScreen })));
    expect(run.directions[0].shots?.every((shot) => shot.keyframeQa?.match === "pass")).toBe(true);
    expect(run.directions[1].shots).toBeUndefined();
    expect(mocks.generateImage).toHaveBeenCalledTimes(script.beats.length);
  });

  it("lets the operator switch to a lower-scored draft without paying for another review", async () => {
    const older = {
      ...reference,
      score: { overall: 4, scores: {}, notes: [], unsupported: [], panel: { stopRate: 0, quotes: [] } },
      checks: [],
      review: { rubric: "studio-script-v1", writer: WRITER, judge: "openai/gpt-6.1-sol", targetSeconds: 15 },
    };
    const previous = { ...older, id: "previous", score: { ...older.score, overall: 9 } };
    Object.assign(run.directions[0], { scripts: [previous, older], approvedScript: previous, storyboardKey: "old-cut", passingDraft: "old-cut" });
    expect((await send("approve_script", { scriptId: reference.id })).status).toBe(200);
    await finish();
    expect(mocks.chatJSON).not.toHaveBeenCalled();
    expect(run.directions[0]).toMatchObject({ approvedScript: { id: reference.id, score: { overall: 4 } }, storyboardKey: null, passingDraft: null });
  });

  it("builds keyframes for an approved script with copy issues, but blocks HD", async () => {
    const blocked = structuredClone(reference);
    blocked.beats[2].onScreen = "Repeat this much too long line until the offer cannot be read on a phone.";
    run.directions[0].scripts = [blocked];
    expect((await send("approve_script", { scriptId: blocked.id })).status).toBe(200);
    await finish();
    expect(run.directions[0].approvedScript?.beats).toEqual(blocked.beats);
    expect(scriptProductionBlockers(run.directions[0].approvedScript)).toEqual(expect.arrayContaining([
      expect.stringContaining("Beat 3: overlay"),
    ]));
    const plan = { category: "product_demo", lengthSec: 15 };
    expect(mocks.chatJSON).not.toHaveBeenCalled();
    mocks.list.mockImplementation((table) => table === "brands" ? [{ url: run.brandUrl, photos: ["/api/media/brand/haldi.jpg"] }] : []);
    mocks.chatJSON.mockResolvedValueOnce(result({ shots: [] })).mockResolvedValue(result({
      score: 9, notes: [], frames: [{ index: 1, match: "pass", note: "" }],
    }));
    mocks.generateImage.mockResolvedValue({ url: "/api/media/run-1/mock-keyframe.jpg", usage: { costUsd: 0 } });
    expect((await send("storyboard", { plan, directionId: undefined })).status).toBe(200);
    await finish();
    expect(run.directions[0].shots?.every((shot) => shot.keyframe && shot.keyframeQa?.match === "pass")).toBe(true);
    expect(mocks.generateImage).toHaveBeenCalledTimes(blocked.beats.length);
    expect(run.directions[0].shots?.[2].onScreen).toBe(blocked.beats[2].onScreen);
    const render = await send("render_video", { tier: "final" });
    expect(render.status).toBe(400);
    expect((await render.json()).error).toMatch(/Before upgrading to HD: Beat 3: overlay/);

    mocks.chatJSON.mockImplementationOnce((_m, _s, prompt: string) => result({ scores: [{
      id: scriptId(prompt), overall: 5, scores: scoreFields, notes: [], proofProblems: [], unsupported: [],
    }] }));
    expect((await send("approve_script", { scriptId: blocked.id, edit: { beats: reference.beats.map(({ vo, onScreen }) => ({ vo, onScreen })) } })).status).toBe(200);
    await finish();
    expect(scriptProductionBlockers(run.directions[0].approvedScript)).toEqual([]);
    expect(run.directions[0].storyboardKey).toBeNull();
  });

  it("rejects a homepage as the only reference before queuing any storyboard work", async () => {
    run.directions[0].approvedScript = { ...reference, proofBrief: { ...proof, asset: run.brandUrl } };
    const response = await send("storyboard", { plan: { category: "product_demo", lengthSec: 15 } });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Add a real product photo in Video plan");
    expect(run.status).toBe("idle");
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.generateImage).not.toHaveBeenCalled();
  });

  it("saves product photos without starting a job and reuses them on later storyboard requests", async () => {
    run.directions[0].approvedScript = reference;
    const response = await send("save_storyboard_photos", { refs: ["data:image/jpeg;base64,AQ=="] });
    expect(response.status).toBe(200);
    expect(run.storyboardPhotos).toEqual([expect.stringMatching(/^\/api\/media\/run-1\/ref-/)]);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.chatJSON).not.toHaveBeenCalled();
    expect(mocks.generateImage).not.toHaveBeenCalled();
    mocks.chatJSON.mockResolvedValueOnce(result({ shots: [] })).mockResolvedValue(result({
      score: 9, notes: [], frames: [{ index: 1, match: "pass", note: "" }],
    }));
    mocks.generateImage.mockResolvedValue({ url: "/api/media/run-1/mock-keyframe.jpg", usage: { costUsd: 0 } });
    expect((await send("storyboard", { plan: { category: "product_demo", lengthSec: 15 } })).status).toBe(200);
    await finish();
    expect(run.status).toBe("idle");
    expect(mocks.mediaDataUrl).toHaveBeenCalledWith(run.storyboardPhotos![0]);
    expect(run.directions[0].productRefs).toEqual(run.storyboardPhotos);
    expect(mocks.generateImage).toHaveBeenCalledTimes(reference.beats.length);
  });

  it("plans the story before the CTA across every supported duration", () => {
    for (const duration of [6, 10, 15, 20, 30]) {
      const windows = storyWindows(duration);
      expect(HOOK_SECONDS + windows.reduce((total, w) => total + w.seconds, 0)).toBe(duration);
      expect(windows.map((w) => w.role).join(" ")).toMatch(/obstacle.*plan.*action.*result.*CTA/i);
      expect(windows.at(-1)!.seconds).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps the valid opening and retries only duplicate or overlong alternatives", async () => {
    const goal = { type: "goal", visual: reference.hook.visual, spoken: reference.hook.spoken };
    mocks.chatJSON.mockResolvedValueOnce(result({ hooks: [
      goal,
      { ...goal, type: "friction" },
      { type: "proof", visual: "The host stands beside the kit.", spoken: "How do I style this whole room without buying a new kit?", onScreen: "" },
    ] })).mockImplementationOnce((_m, _s, prompt: string) => {
      expect(prompt).toMatch(/Write exactly 2 opening shot\(s\), one per requested type: friction:/);
      expect(prompt).toContain("friction: Use a different shot and spoken line.");
      expect(prompt).toContain("proof: The spoken line is too long");
      return result({ hooks: [
        { type: "friction", visual: "A closet crowded with old décor.", spoken: "I need space for Haldi.", onScreen: null },
        { type: "proof", visual: "A host lifts a marigold strand.", spoken: "Could this work at home?", onScreen: "Haldi at home" },
      ] });
    }).mockImplementationOnce((_m, _s, prompt: string) => {
      const hooks = JSON.parse(prompt.split("Openings: ")[1].split("\nScore")[0]);
      expect(hooks[0]).toMatchObject({ ...goal, onScreen: "" });
      expect(hooks[1].onScreen).toBe("");
      return result({ reviews: hooks.map(({ id }: { id: string }) => ({ id, score: 8, note: "Reviewed", blockers: [] })) });
    });

    expect((await send("draft_hooks", { proof })).status).toBe(200);
    await finish();
    expect(run.directions[0].hookLab?.hooks).toHaveLength(3);
    expect(run.costUsd).toBeCloseTo(0.03);
    expect(mocks.chatJSON).toHaveBeenCalledTimes(3);
  });

  it("shows a partial batch without allowing blocked openings to write scripts", async () => {
    mocks.chatJSON.mockResolvedValueOnce(result({ hooks: [
      { type: "goal", ...reference.hook },
      { type: "friction", visual: "A closet crowded with old décor.", spoken: "I need space for Haldi.", onScreen: "This overlay is much too long for anyone to read in the time available." },
    ] })).mockResolvedValueOnce(result({ hooks: [{ type: "wrongtype" }] }))
      .mockImplementationOnce((_m, _s, prompt: string) => {
        const hooks = JSON.parse(prompt.split("Openings: ")[1].split("\nScore")[0]);
        return result({ reviews: hooks.map(({ id }: { id: string }) => ({ id, score: 10, note: "Reviewed", blockers: ["Stakes are unclear."] })) });
      });
    expect((await send("draft_hooks", { proof })).status).toBe(200);
    await finish();
    expect(run.directions[0].hookLab?.hooks).toHaveLength(1);
    expect(run.events.at(-1)?.text).toContain("Only 1 of 3 openings");
    expect((await send("write_scripts", { hookId: run.directions[0].hookLab!.hooks[0].id })).status).toBe(400);
    expect(mocks.chatJSON).toHaveBeenCalledTimes(3);
  });

  it("reports concrete validation failures if no opening survives one retry", async () => {
    mocks.chatJSON.mockResolvedValue(result({ hooks: [{ type: "unknown" }] }));
    expect((await send("draft_hooks", { proof })).status).toBe(200);
    await finish();
    expect(run.status).toBe("error");
    expect(run.events.at(-1)?.text).toContain('invalid "type" field');
    expect(run.directions[0].hookLab?.brief).toEqual(proof);
    expect(run.costUsd).toBeCloseTo(0.02);
    expect(mocks.chatJSON).toHaveBeenCalledTimes(2);
  });

  it("keeps a script with no story payoff out of production even when the model returns 9+", async () => {
    const hook = {
      id: "e1f6bb20-ad14-49f0-a897-78cd2570a400", type: "goal" as const, ...reference.hook,
      review: { score: 9, note: "Reviewed", blockers: [] },
    };
    run.directions[0].hookLab = { id: "lab", brief: proof, hooks: [hook], writer: WRITER, lengthSec: 15 };
    mocks.chatJSON.mockResolvedValueOnce(result({ beats: reference.beats.slice(1).map((b, i) => i === 1 ? { ...b, visual: "A generic wide shot of an empty room." } : b) }))
      .mockImplementationOnce((_m, _s, prompt: string) => result({ scores: [{
        id: scriptId(prompt), overall: 9.8, scores: scoreFields, notes: [], proofProblems: ["No payoff is shown."], unsupported: [],
      }] }));
    expect((await send("write_scripts", { hookId: hook.id })).status).toBe(200);
    await finish();
    const s = run.directions[0].scripts![0];
    expect(scriptReady(s)).toBe(false);
    expect(s.score?.notes).toEqual(["No payoff is shown."]);
    expect((await send("approve_script", { scriptId: s.id })).status).toBe(200);
    await finish();
    expect(run.status).toBe("idle");
    expect(run.directions[0].approvedScript?.id).toBe(s.id);
    Object.assign(run.directions[0], { storyboardKey: "existing", shots: [{ id: "s0", keyframe: "/api/media/run-1/kf.jpg" }], productRefs: ["/api/media/run-1/kit.jpg"] });
    run.videoPlan = { category: "product_demo", lengthSec: 15, draftModel: "video", finalModel: "video", voice: "Rachel", music: false, budgetUsd: 3 };
    const response = await send("render_video", { tier: "final" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("No payoff is shown.");
    expect(mocks.chatJSON).toHaveBeenCalledTimes(2);
  });
});
