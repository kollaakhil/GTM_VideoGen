import { execFileSync } from "node:child_process";
import fs from "node:fs";
import ffmpegPath from "ffmpeg-static";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fitOffer, offerLine, typesetStatic } from "../src/lib/video-post";
import { planFix, triageNotes } from "../src/lib/qa-triage";
import { claimHits } from "../src/lib/gate";
import { CLAIM_RULE, principlesBlock } from "../src/lib/ad-wisdom";
import type { Brief, Direction, Research, StudioRun } from "../src/lib/types";

const PATAGONIA_OFFER = "Ironclad Guarantee, Worn Wear repair and resale programs for every Better Sweater";

function bg(file: string, color = "black") {
  execFileSync(ffmpegPath as string, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${color}:s=1080x1350`, "-frames:v", "1", "-y", file]);
  return "data:image/png;base64," + fs.readFileSync(file).toString("base64");
}

/** Brightest pixel in a vertical strip of the PNG (white text on a black scene shows up as > 0). */
function brightestInStrip(png: Buffer, x: number, w: number) {
  fs.writeFileSync("/tmp/tqc-out.png", png);
  const raw = execFileSync(ffmpegPath as string, ["-hide_banner", "-loglevel", "error", "-i", "/tmp/tqc-out.png", "-vf", `crop=${w}:1350:${x}:0,format=gray`, "-f", "rawvideo", "-"]);
  return raw.reduce((m, v) => Math.max(m, v), 0);
}

describe("bug A: offer line fits the static ad", () => {
  it("wraps the Patagonia offer at word/comma boundaries into at most 2 lines within ~940px", () => {
    const f = fitOffer(PATAGONIA_OFFER);
    expect(f.lines.length).toBeGreaterThan(0);
    expect(f.lines.length).toBeLessThanOrEqual(2);
    for (const l of f.lines) expect(l.length * f.size * 0.6).toBeLessThanOrEqual(940);
    // every printed word is a whole word from the source (no "resa…")
    const source = new Set(PATAGONIA_OFFER.replace(/,/g, "").split(" "));
    for (const w of f.text.replace(/,/g, "").split(" ")) expect(source.has(w)).toBe(true);
    expect(f.text.startsWith("Ironclad Guarantee")).toBe(true);
  });

  it("drops trailing comma clauses before cutting words", () => {
    const f = fitOffer("Free shipping, free returns, lifetime repairs at any of our forty-two stores worldwide, plus member pricing on everything");
    expect(f.lines.length).toBeLessThanOrEqual(2);
    expect(f.text).toMatch(/^Free shipping, free returns/);
    expect(f.text.endsWith(",")).toBe(false);
  });

  it("keeps prices like $249.99 when taking the first sentence", () => {
    expect(offerLine("From $249.99 a weekend. Terms apply")).toBe("From $249.99 a weekend");
    expect(offerLine(null)).toBe("");
  });

  it("never paints offer text past the right edge of the 1080px image", async () => {
    const out = await typesetStatic(bg("/tmp/tqc-black.png"), { brand: "Patagonia", headline: "Warm now, repairable for years", offer: PATAGONIA_OFFER, cta: "SHOP_NOW", primary: "#000000" });
    const png = Buffer.from(out.split(",")[1], "base64");
    expect(png.readUInt32BE(16)).toBe(1080);
    expect(brightestInStrip(png, 1030, 50)).toBeLessThan(40);
    // tighter re-typeset still renders
    const tight = await typesetStatic(bg("/tmp/tqc-black.png"), { brand: "Patagonia", headline: "Warm now, repairable for years", offer: PATAGONIA_OFFER, cta: "SHOP_NOW", primary: "#000000" }, { tighter: 2 });
    expect(brightestInStrip(Buffer.from(tight.split(",")[1], "base64"), 1000, 80)).toBeLessThan(40);
  }, 30_000);
});

describe("bug B: QA notes are routed to whoever can fix them", () => {
  const typesetNote = "The offer line runs off the right edge and is cut mid-word ('resa…'); wrap it.";
  const pictureNote = "The hand holding the sweater looks distorted at the fingers.";

  it("classifies typeset vs picture notes and ignores bookkeeping lines", () => {
    const t = triageNotes(["Best of 2 takes (scores 5, 5)", typesetNote, "Headline is hard to read against the busy background", pictureNote, "Garbled text on the hang tag label"]);
    expect(t.typeset).toEqual([typesetNote, "Headline is hard to read against the busy background"]);
    expect(t.picture).toEqual([pictureNote, "Garbled text on the hang tag label"]);
  });

  it("re-typesets without a new render when only text layout is wrong", () => {
    expect(planFix(["Best of 2 takes (scores 5, 5)", typesetNote], true)).toEqual({ rerender: false, imageFixes: [], retypeset: true });
  });

  it("sends only picture notes to the image model", () => {
    expect(planFix([typesetNote, pictureNote], true)).toEqual({ rerender: true, imageFixes: [pictureNote], retypeset: true });
  });

  it("sends every note to the image model when the model drew the text itself", () => {
    expect(planFix(["Auto-fixed after QA (was 5/10)", typesetNote], false)).toEqual({ rerender: true, imageFixes: [typesetNote], retypeset: false });
  });
});

describe("bug C: comparison claims need proof", () => {
  it("puts the comparison/superlative rule in every concept and direction prompt", () => {
    expect(principlesBlock()).toContain(CLAIM_RULE);
    expect(CLAIM_RULE).toMatch(/only/);
    expect(CLAIM_RULE).toMatch(/Us vs them/);
  });

  it("attributes a quoted claim to the right piece of copy", () => {
    expect(claimHits("Only one is guaranteed", "\"Only one is guaranteed\"")).toBe(true);
    expect(claimHits("Ironclad Guarantee, Worn Wear repair", "Only one is guaranteed")).toBe(false);
  });
});

// End-to-end through the Studio route with providers mocked: proves the claims check runs before any image is paid for,
// and that a typeset-only QA failure is fixed with no extra image render.
const mocks = vi.hoisted(() => ({
  after: vi.fn(), get: vi.fn(), put: vi.fn(), list: vi.fn(), chatJSON: vi.fn(), generateImage: vi.fn(), storeMedia: vi.fn(), mediaDataUrl: vi.fn(),
}));
vi.mock("next/server", async (importOriginal) => ({ ...await importOriginal<object>(), after: mocks.after }));
vi.mock("@/lib/session", () => ({ currentUser: async () => "test-user" }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => true }));
vi.mock("@/lib/store", async (importOriginal) => ({
  ...await importOriginal<object>(), get: mocks.get, put: mocks.put, list: mocks.list, storeMedia: mocks.storeMedia, mediaDataUrl: mocks.mediaDataUrl,
}));
vi.mock("@/lib/ai", async (importOriginal) => ({ ...await importOriginal<object>(), chatJSON: mocks.chatJSON, generateImage: mocks.generateImage }));

describe("Studio static generate (providers mocked)", () => {
  const research = { brand: "Patagonia", summary: "Patagonia makes outdoor clothing with an Ironclad Guarantee and Worn Wear repair and resale.", audience: "Outdoor commuters", valueProps: ["Ironclad Guarantee", "Worn Wear repair and resale"], tone: "Plainspoken", angles: ["Durability", "Repair"], sources: [] } as unknown as Research;
  const brief = { objective: "Sell the Better Sweater", audience: "Commuters", insight: "People want a fleece that lasts.", offer: PATAGONIA_OFFER, mandatories: [], kpi: "ROAS" } as Brief;
  const direction = {
    id: "dir_0", title: "Us vs them", hook: "Only one is guaranteed", angle: "Durability", format: "static", script: "", visualPrompt: "A fleece on a hook by a door",
    copy: { metaPrimaryText: "x", metaHeadline: "Only one is guaranteed", metaCta: "SHOP_NOW", googleHeadlines: [], googleDescriptions: [] },
  } as unknown as Direction;
  let run: StudioRun;
  let qaCalls = 0;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.OPENROUTER_API_KEY = "test-key";
    qaCalls = 0;
    run = {
      id: "run-1", brandUrl: "https://www.patagonia.com/better-sweater", goal: "Sell the Better Sweater", format: "static",
      models: { text: "text", image: "image", video: "video", vision: "vision" },
      stage: "generate", status: "idle", activity: null, events: [], progress: {}, research, brief,
      directions: [structuredClone(direction)], creativeIds: [], costUsd: 0, createdBy: "test-user", createdAt: "2026-01-01", updatedAt: "2026-01-01",
    } as unknown as StudioRun;
    const scene = bg("/tmp/tqc-scene.png", "0x334455");
    mocks.get.mockImplementation((table) => (table === "studio_runs" ? structuredClone(run) : null));
    mocks.put.mockImplementation((table, row) => { if (table === "studio_runs") run = structuredClone(row); });
    mocks.list.mockResolvedValue([]);
    mocks.storeMedia.mockImplementation(async (_u: string, key: string) => `/api/media/${key}.png`);
    mocks.mediaDataUrl.mockResolvedValue(null);
    mocks.generateImage.mockResolvedValue({ url: scene, usage: { costUsd: 0.04 } });
    mocks.chatJSON.mockImplementation(async (_model: string, system: string, prompt: unknown) => {
      const text = typeof prompt === "string" ? prompt : JSON.stringify(prompt);
      if (system.includes("ad compliance reviewer")) return { data: { unsupported: text.includes("Headline: Only one is guaranteed") ? ["Only one is guaranteed"] : [], missing: [] }, usage: { costUsd: 0.001 } };
      if (system.includes("You fix ad headlines")) return { data: { headline: "Built to be repaired, not replaced" }, usage: { costUsd: 0.001 } };
      qaCalls++;
      return qaCalls <= 2
        ? { data: { score: 5, notes: ["The offer line runs off the right edge and is cut mid-word."] }, usage: { costUsd: 0.002 } }
        : { data: { score: 9, notes: [] }, usage: { costUsd: 0.002 } };
    });
  });
  afterEach(() => { delete process.env.OPENROUTER_API_KEY; });

  it("rewrites the unsupported headline before rendering and fixes text QA without a new render", async () => {
    const { POST } = await import("@/app/api/studio/route");
    const res = await POST(new Request("http://test/api/studio", { method: "POST", body: JSON.stringify({ action: "generate", runId: "run-1" }) }));
    expect(res.status).toBe(200);
    await mocks.after.mock.lastCall![0]();

    const firstClaims = mocks.chatJSON.mock.calls.findIndex((c) => String(c[1]).includes("ad compliance reviewer"));
    expect(firstClaims).toBeGreaterThanOrEqual(0);
    expect(mocks.chatJSON.mock.invocationCallOrder[firstClaims]).toBeLessThan(mocks.generateImage.mock.invocationCallOrder[0]);
    expect(run.directions[0].copy?.metaHeadline).toBe("Built to be repaired, not replaced");

    expect(mocks.generateImage).toHaveBeenCalledTimes(2); // the tournament takes only; the fix was a free re-typeset
    for (const call of mocks.generateImage.mock.calls) expect(String(call[1])).not.toContain("Fix these issues");

    const creative = mocks.put.mock.calls.filter((c) => c[0] === "creatives").map((c) => c[1]).pop();
    expect(creative.qa.score).toBe(9);
    expect(creative.qa.notes[0]).toMatch(/Auto-retypeset after QA, no new render \(was 5\/10\)/);
    expect(creative.gate.unsupported).toEqual([]);
  }, 60_000);
});
