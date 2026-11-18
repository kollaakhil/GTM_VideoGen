import { describe, expect, it } from "vitest";
import { copiesLine, inspirationGuidance, pacing, shotWindows, swipeStructure } from "@/lib/inspiration";
import type { InspirationBreakdown } from "@/lib/types";

const base: InspirationBreakdown = {
  id: "s1", source: "https://example.com/ad.mp4", kind: "video", duration: 12, shotCount: 4, avgShotSec: 3, cutsPerSec: 0.25, firstCutSec: 1.2, firstWordSec: 0.3, wordsPerSec: 2.6,
  via: { cuts: "scenedetect", transcript: "whisper.cpp", ocr: "tesseract", vision: "vlm" }, thumb: null, textOnScreen: [],
  shots: [{ start: 0, end: 1.2, framing: "extreme close-up", lens: "macro", motion: "push-in", purpose: "hook", textStyle: "bold caption top" }],
  format: "Product demo", hook: "Opens on a tight detail before the reveal", pacing: "fast first second, then steady", textStyle: "bold captions", whyItWorks: "Shows the payoff early", beats: ["hook", "demo", "cta"], costUsd: 0.002,
};

describe("inspiration breakdown", () => {
  it("turns cut times into shot windows and merges slivers", () => {
    expect(shotWindows([1.2, 1.3, 4, 11.9], 12)).toEqual([{ start: 0, end: 1.3 }, { start: 1.3, end: 4 }, { start: 4, end: 12 }]);
    expect(shotWindows([], 6)).toEqual([{ start: 0, end: 6 }]);
  });
  it("measures pacing from cuts and word timings", () => {
    const p = pacing([{ start: 0, end: 2 }, { start: 2, end: 6 }], 6, [{ start: 0.4, end: 0.6 }, { start: 1, end: 1.2 }, { start: 2.4, end: 2.9 }]);
    expect(p).toEqual({ shotCount: 2, avgShotSec: 3, cutsPerSec: 0.17, firstCutSec: 2, firstWordSec: 0.4, wordsPerSec: 1.2 });
    expect(pacing([{ start: 0, end: 5 }], 5, null)).toMatchObject({ firstCutSec: null, wordsPerSec: null });
  });
  it("flags verbatim lines but allows paraphrase", () => {
    const transcript = "Stop scrolling, this jacket kept me warm through a whole winter in Chicago";
    expect(copiesLine("Says this jacket kept me warm through a whole winter", transcript)).toBe(true);
    expect(copiesLine("Opens with a direct call to stop, then a cold-weather testimonial", transcript)).toBe(false);
  });
  it("feeds structure, not content, to the shot planner and the script writer", () => {
    const g = inspirationGuidance([base]);
    expect(g).toContain("4 shots (avg 3s)");
    expect(g).toContain("first cut at 1.2s");
    expect(g).toContain("framing: extreme close-up");
    expect(g).toMatch(/never their footage/);
    expect(inspirationGuidance([{ ...base, kind: "image" }])).toBe("");
    expect(swipeStructure(base)).toEqual({ hook: base.hook, beats: base.beats, format: "Product demo", whyItWorks: base.whyItWorks });
    expect(swipeStructure({ ...base, hook: "", beats: [], format: "", whyItWorks: "" })).toMatchObject({ hook: "First cut at 1.2s", beats: ["hook"], format: "Video ad" });
  });
});

describe("start screen request", async () => {
  const { Body } = await import("@/lib/studio/schema");
  const base = { action: "research", brandUrl: "https://example.com", goal: "Sell more", format: "video" };
  it("accepts links and uploads, and rejects an inspiration that is both or neither", () => {
    expect(Body.safeParse({ ...base, autoBrief: true, inspirations: [{ url: "https://example.com/ad" }, { upload: "data:video/mp4;base64,AAAA", name: "ad.mp4" }] }).success).toBe(true);
    expect(Body.safeParse({ ...base, inspirations: [{ url: "https://example.com/ad", upload: "data:video/mp4;base64,AAAA" }] }).success).toBe(false);
    expect(Body.safeParse({ ...base, inspirations: [{}] }).success).toBe(false);
    expect(Body.safeParse({ ...base, inspirations: [{ upload: "data:application/pdf;base64,AAAA" }] }).success).toBe(false);
    expect(Body.safeParse({ ...base, inspirations: Array(5).fill({ url: "https://example.com" }) }).success).toBe(false);
  });
});
