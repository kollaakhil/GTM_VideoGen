import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/studio/route";
import { applyScriptEdit, checkScript, inspirationRule, reviewScript, scriptLab, WRITER } from "@/lib/script-lab";
import { SCRIPT_STYLE_IDS, styleTemplate } from "@/lib/script-styles";
import { preflightScript } from "@/lib/gate";
import { JEV_URL, readJev } from "@/lib/jev";
import { scriptProductionBlockers, SCRIPT_RUBRIC } from "@/lib/quality-policy";
import { Body } from "@/lib/studio/schema";
import type { AdScript, StudioRun, Swipe } from "@/lib/types";
import { brief, direction, proof, reference, research } from "./fixtures/script-proof";

const mocks = vi.hoisted(() => ({ after: vi.fn(), get: vi.fn(), put: vi.fn(), list: vi.fn(), chatJSON: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({ ...await importOriginal<object>(), after: mocks.after }));
vi.mock("@/lib/session", () => ({ currentUser: async () => "test-user" }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => true }));
vi.mock("@/lib/store", async (importOriginal) => ({ ...await importOriginal<object>(), get: mocks.get, put: mocks.put, list: mocks.list }));
vi.mock("@/lib/ai", async (importOriginal) => ({ ...await importOriginal<object>(), chatJSON: mocks.chatJSON }));

const result = (data: object, costUsd = 0.01) => ({ data, usage: { costUsd } });
const scoreFields = Object.fromEntries(["hook", "clarity", "specificity", "customerLanguage", "emotion", "productEarly", "cta", "pacing", "claims"].map((k) => [k, 8]));
const scriptId = (prompt: string) => JSON.parse(prompt.split("Scripts:\n")[1].split("\nScore")[0])[0].id;
const judgeReply = (overall: number, extra: Record<string, number> = {}) => (_m: string, _s: string, prompt: string) =>
  result({ scores: [{ id: scriptId(prompt), overall, scores: { ...scoreFields, ...extra }, notes: [], unsupported: [], proofProblems: [] }] });
const ctx = { direction, brief, research, lengthSec: 15, proof };
const JUDGE = "openai/gpt-6.1-sol";
const reviewed: AdScript = {
  ...reference, checks: [],
  score: { overall: 8, scores: scoreFields, notes: [], unsupported: [], proofProblems: [], panel: { stopRate: 0, quotes: [] } },
  review: { rubric: SCRIPT_RUBRIC, writer: WRITER, judge: JUDGE, targetSeconds: 15 },
};
const swipe: Swipe = {
  id: "sw1", brandUrl: null, url: null, image: null, note: "", createdBy: "u", createdAt: "2026-01-01",
  structure: { hook: "POV: you forgot the décor", beats: ["Problem", "Unbox", "Reveal"], format: "UGC selfie", whyItWorks: "Relatable panic" },
};
const jevBody = (p: Record<string, number>, cost = 0.00002) => ({
  model: "typesafe/jev-1.13-20260917",
  answers: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { type: "noul", noul: v }])),
  usage: { input_tokens: 500, output_tokens: 0, cost },
});
const confidentPass = { hook_in_3s: 0.95, cta_clear: 0.97, product_early: 0.9, unsupported_claim: 0.04 };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue([]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.JEV_GATES;
  delete process.env.OPENROUTER_API_KEY;
});

describe("script style picker", () => {
  it("adds nothing for auto and the chosen structure for every other style", () => {
    expect(styleTemplate("auto")).toBe("");
    expect(styleTemplate(undefined)).toBe("");
    expect(styleTemplate("not-a-style")).toBe("");
    for (const id of SCRIPT_STYLE_IDS.filter((x) => x !== "auto")) expect(styleTemplate(id)).toMatch(/Script style \(chosen by the operator\)/);
    expect(styleTemplate("ugc_testimonial")).toContain("UGC testimonial");
    expect(styleTemplate("listicle")).toContain("numbered");
  });

  it("feeds the chosen style into the writer prompt and stores it on the script", async () => {
    mocks.chatJSON.mockResolvedValueOnce(result({ beats: reference.beats.slice(1) })).mockImplementationOnce(judgeReply(9));
    const r = await scriptLab({ ...ctx, scriptStyle: "problem_fix" }, { id: "h", type: "goal", ...reference.hook }, WRITER, JUDGE);
    expect(mocks.chatJSON.mock.calls[0][2]).toContain("Problem and fix");
    expect(r.script.style).toBe("problem_fix");
  });

  it("accepts only known styles on the API", () => {
    const base = { action: "write_scripts", runId: "r", directionId: "d", lengthSec: 15, hookId: "e1f6bb20-ad14-49f0-a897-78cd2570a400" };
    expect(Body.safeParse({ ...base, style: "founder_story" }).success).toBe(true);
    expect(Body.safeParse({ ...base, style: "viral_dance" }).success).toBe(false);
  });
});

describe("inspiration match", () => {
  it("skips the dimension without inspirations and drops it if the judge returns one anyway", async () => {
    expect(inspirationRule({})).toBe("");
    mocks.chatJSON.mockImplementationOnce(judgeReply(8, { inspirationMatch: 2 }));
    const r = await reviewScript(reference, ctx, WRITER, JUDGE);
    expect(mocks.chatJSON.mock.calls[0][2]).not.toContain("inspirationMatch");
    expect(r.script.score.scores.inspirationMatch).toBeUndefined();
    expect(r.script.score.overall).toBe(8);
  });

  it("scores hook, pacing and tone match when swipes exist", async () => {
    mocks.chatJSON.mockImplementationOnce(judgeReply(8, { inspirationMatch: 7 }));
    const r = await reviewScript(reference, { ...ctx, swipes: [swipe] }, WRITER, JUDGE);
    const prompt = mocks.chatJSON.mock.calls[0][2] as string;
    expect(prompt).toContain('"inspirationMatch"');
    expect(prompt).toContain("POV: you forgot the décor");
    expect(r.script.score.scores.inspirationMatch).toBe(7);
  });
});

describe("editable hook and CTA", () => {
  it("keeps the hook in sync with beat 1 and moves the CTA into the last beat and proof brief", () => {
    const next = applyScriptEdit(reference, { hook: "Mum wants Haldi photos here.", hookOnScreen: "Haldi at home", cta: "Book a kit" });
    expect(next.hook).toMatchObject({ spoken: "Mum wants Haldi photos here.", onScreen: "Haldi at home" });
    expect(next.beats[0]).toMatchObject({ vo: "Mum wants Haldi photos here.", onScreen: "Haldi at home" });
    expect(next.beats.at(-1)).toMatchObject({ vo: "Tap Book a kit.", onScreen: "Book a kit" });
    expect(next.proofBrief?.cta).toBe("Book a kit");
    expect(checkScript(next, 15)).toEqual([]);
    expect(reference.cta).toBe(proof.cta);
  });

  describe("rescore_script route", () => {
    let run: StudioRun;
    const send = (fields: object) => POST(new Request("http://test/api/studio", {
      method: "POST", body: JSON.stringify({ action: "rescore_script", runId: "run-1", directionId: direction.id, scriptId: reference.id, ...fields }),
    }));
    beforeEach(() => {
      run = {
        id: "run-1", brandUrl: "https://example.com/haldi", goal: brief.objective, format: "video",
        models: { text: "text", image: "image", video: "video", vision: "vision" },
        stage: "generate", status: "idle", activity: null, events: [], progress: {}, research, brief,
        directions: [{ ...structuredClone(direction), scripts: [structuredClone(reviewed)], approvedScript: structuredClone(reviewed), storyboardKey: "old" }],
        creativeIds: [], costUsd: 0, createdBy: "test-user", createdAt: "2026-01-01", updatedAt: "2026-01-01",
      };
      mocks.get.mockImplementation((table) => table === "studio_runs" ? structuredClone(run) : null);
      mocks.put.mockImplementation((table, row) => { if (table === "studio_runs") run = structuredClone(row); });
    });

    it("re-checks and re-scores an edited hook and CTA, and clears the old approval", async () => {
      mocks.chatJSON.mockImplementationOnce(judgeReply(9));
      expect((await send({ edit: { hook: "Mum wants Haldi photos here.", cta: "Book a kit" } })).status).toBe(200);
      await mocks.after.mock.lastCall![0]();
      const sc = run.directions[0].scripts![0];
      expect(sc.hook.spoken).toBe("Mum wants Haldi photos here.");
      expect(sc.cta).toBe("Book a kit");
      expect(sc.checks).toEqual([]);
      expect(sc.score?.overall).toBe(9);
      expect(mocks.chatJSON).toHaveBeenCalledTimes(1);
      expect(run.directions[0]).toMatchObject({ approvedScript: null, storyboardKey: null });
      expect(run.events.at(-1)?.text).toContain("Re-scored: 9/10");
    });

    it("flags an edited line with an unsupported claim", async () => {
      process.env.OPENROUTER_API_KEY = "test-key";
      mocks.chatJSON
        .mockResolvedValueOnce(result({ unsupported: ["the only rental that ships tomorrow"], missing: [] }))
        .mockImplementationOnce(judgeReply(8));
      const beats = reference.beats.map(({ vo, onScreen }, i) => i === 1 ? { vo: "The only rental that ships tomorrow.", onScreen } : { vo, onScreen });
      expect((await send({ edit: { beats } })).status).toBe(200);
      await mocks.after.mock.lastCall![0]();
      const sc = run.directions[0].scripts![0];
      expect(sc.claimFlags).toEqual([{ where: "beat 2 voiceover", claim: "the only rental that ships tomorrow" }]);
      expect(scriptProductionBlockers(sc)).toContain("Unsupported claim in beat 2 voiceover: the only rental that ships tomorrow");
      expect(run.events.at(-1)?.role).toBe("error");
    });
  });
});

describe("claims preflight on the full script and body copy", () => {
  beforeEach(() => { process.env.OPENROUTER_API_KEY = "test-key"; });
  const copy = {
    metaPrimaryText: "Rent a Haldi décor kit for $299 per weekend.", metaHeadline: "Haldi décor, rented",
    metaCta: "Learn more", googleHeadlines: ["Best Haldi kit in town", "Rent Haldi décor"], googleDescriptions: [],
  };

  it("checks every VO, on-screen line, primary text and Google headline in one call", async () => {
    mocks.chatJSON.mockResolvedValueOnce(result({ unsupported: [], missing: [] }));
    const pf = await preflightScript("text", { script: reference, copy, research, brief });
    const prompt = mocks.chatJSON.mock.calls[0][2] as string;
    for (const label of ["beat 1 voiceover", "beat 4 on-screen text", "primary text", "Google headline 1", "Google headline 2"]) expect(prompt).toContain(label);
    expect(pf.flags).toEqual([]);
  });

  it("rewrites an unsupported superlative in body copy and flags the one in the script", async () => {
    const script = applyScriptEdit(reference, { beats: reference.beats.map(({ vo, onScreen }, i) => i === 2 ? { vo: "Better than buying décor.", onScreen } : { vo, onScreen }) });
    mocks.chatJSON
      .mockResolvedValueOnce(result({ unsupported: ["Best Haldi kit in town", "Better than buying décor"], missing: [] }))
      .mockResolvedValueOnce(result({ fixes: { "Google headline 1": "Haldi kit for the weekend" } }))
      .mockResolvedValueOnce(result({ unsupported: [], missing: [] }));
    const pf = await preflightScript("text", { script, copy, research, brief });
    expect(pf.copy?.googleHeadlines[0]).toBe("Haldi kit for the weekend");
    expect(pf.changes[0]).toContain("Google headline 1");
    expect(pf.flags).toEqual([{ where: "beat 3 voiceover", claim: "Better than buying décor" }]);
    expect(pf.cost).toBeCloseTo(0.03);
  });

  it("keeps body copy flagged when the rewrite still fails the check", async () => {
    mocks.chatJSON
      .mockResolvedValueOnce(result({ unsupported: ["Best Haldi kit in town"], missing: [] }))
      .mockResolvedValueOnce(result({ fixes: { "Google headline 1": "The best Haldi kit" } }))
      .mockResolvedValueOnce(result({ unsupported: ["The best Haldi kit"], missing: [] }));
    const pf = await preflightScript("text", { script: reference, copy, research, brief });
    expect(pf.copy?.googleHeadlines[0]).toBe("Best Haldi kit in town");
    expect(pf.flags).toEqual([{ where: "Google headline 1", claim: "Best Haldi kit in town" }]);
  });

  it("is free and silent without an API key", async () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(await preflightScript("text", { script: reference, copy, research, brief })).toMatchObject({ flags: [], cost: 0 });
    expect(mocks.chatJSON).not.toHaveBeenCalled();
  });
});

describe("Jev gate", () => {
  const edited = applyScriptEdit(reviewed, { hook: "Mum wants Haldi photos here." });
  beforeEach(() => {
    process.env.JEV_GATES = "1";
    process.env.OPENROUTER_API_KEY = "test-key";
  });

  it("reads probabilities into pass, flags and confidence", () => {
    expect(readJev(jevBody(confidentPass))).toMatchObject({ escalate: false, reasons: [], cost: 0.00002 });
    const flagged = readJev(jevBody({ ...confidentPass, unsupported_claim: 0.9 }));
    expect(flagged.escalate).toBe(true);
    expect(flagged.reasons[0]).toMatch(/claim/);
    const unsure = readJev(jevBody({ ...confidentPass, cta_clear: 0.7 }));
    expect(unsure.escalate).toBe(true);
    expect(unsure.reasons[0]).toContain("cta_clear (0.70)");
    expect(() => readJev({ answers: {} })).toThrow();
  });

  it("a confident pass on an edited, previously reviewed script skips the judge", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(jevBody(confidentPass))));
    vi.stubGlobal("fetch", fetch);
    const r = await reviewScript(edited, ctx, WRITER, JUDGE, { prior: reviewed });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(JEV_URL);
    const sent = JSON.parse(init.body as string);
    expect(sent.model).toBe("typesafe/jev-1.13");
    expect(Object.keys(sent.questions)).toEqual(["hook_in_3s", "cta_clear", "product_early", "unsupported_claim"]);
    expect(sent.questions.hook_in_3s.type).toBe("noul");
    expect(mocks.chatJSON).not.toHaveBeenCalled();
    expect(r.script.gate).toMatchObject({ skippedJudge: true, cost: 0.00002 });
    expect(r.script.score.overall).toBe(8);
    expect(r.cost).toBe(0.00002);
  });

  it("low confidence escalates to the judge", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(jevBody({ ...confidentPass, hook_in_3s: 0.6 })))));
    mocks.chatJSON.mockImplementationOnce(judgeReply(6));
    const r = await reviewScript(edited, ctx, WRITER, JUDGE, { prior: reviewed });
    expect(mocks.chatJSON).toHaveBeenCalledTimes(1);
    expect(r.script.gate).toMatchObject({ skippedJudge: false });
    expect(r.script.gate?.reasons[0]).toContain("hook_in_3s");
    expect(r.script.score.overall).toBe(6);
    expect(r.cost).toBeCloseTo(0.01002);
  });

  it("a flagged problem escalates even when Jev is confident", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(jevBody({ ...confidentPass, unsupported_claim: 0.97 })))));
    mocks.chatJSON.mockImplementationOnce(judgeReply(6));
    await reviewScript(edited, ctx, WRITER, JUDGE, { prior: reviewed });
    expect(mocks.chatJSON).toHaveBeenCalledTimes(1);
  });

  it("falls back to the judge when the Jev call fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream down", { status: 502 })));
    mocks.chatJSON.mockImplementationOnce(judgeReply(7));
    const r = await reviewScript(edited, ctx, WRITER, JUDGE, { prior: reviewed });
    expect(mocks.chatJSON).toHaveBeenCalledTimes(1);
    expect(r.script.gate).toBeUndefined();
    expect(r.script.score.overall).toBe(7);
  });

  it("never carries scores without a clean prior review, and stays off without JEV_GATES", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(jevBody(confidentPass))));
    vi.stubGlobal("fetch", fetch);
    mocks.chatJSON.mockImplementation(judgeReply(7));
    const first = await reviewScript(reference, ctx, WRITER, JUDGE);
    expect(first.script.gate?.skippedJudge).toBe(false);
    expect(mocks.chatJSON).toHaveBeenCalledTimes(1);
    delete process.env.JEV_GATES;
    fetch.mockClear();
    await reviewScript(edited, ctx, WRITER, JUDGE, { prior: reviewed });
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.chatJSON).toHaveBeenCalledTimes(2);
  });
});
