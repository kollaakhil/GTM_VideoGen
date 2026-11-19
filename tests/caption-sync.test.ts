import { describe, expect, it } from "vitest";
import { alignWords, captionSync, captionSyncFindings, tokens } from "@/lib/caption-sync";
import { finalChecks } from "@/lib/stage-gates";

const w = (text: string, start: number, step = 0.3) => text.split(" ").map((word, i) => ({ word, start: start + i * step, end: start + i * step + 0.25 }));

describe("word-by-word captions vs voice", () => {
  it("normalises numbers and units both ways", () => {
    expect(tokens("Only 5g sugar")).toEqual(tokens("only five grams sugar"));
    expect(tokens("50% off")).toEqual(tokens("fifty percent off"));
  });
  it("aligns words and reports misses and extras", () => {
    expect(alignWords(["a", "b", "c"], ["a", "x", "c"])).toEqual({ matched: 2, missing: ["b"], extra: ["x"] });
  });
  it("passes in-sync captions and flags a late or wrong one", () => {
    const words = [...w("tastes like the cola you grew up with", 0), ...w("only five grams of sugar", 3)];
    const sync = captionSync([{ start: 0, end: 2.6, text: "Tastes like the cola you grew up with" }, { start: 3, end: 4.6, text: "Only 5g of sugar" }], words);
    expect(sync.map((s) => s.coverage)).toEqual([1, 1]);
    expect(captionSyncFindings(sync)).toEqual({ findings: [], score: 10 });
    const late = captionSync([{ start: 0, end: 1, text: "Only 5g of sugar" }], words);
    const f = captionSyncFindings(late);
    expect(f.findings[0].status).toBe("fail");
    expect(f.score).toBeLessThan(5);
  });
  it("adds word-sync and sampled-frame rows to the final rubric", () => {
    const rows = finalChecks({ craft: 9, findings: [], shotScores: [9, 10], captionSync: 9.5, frameScores: [10, 10, 7] });
    expect(rows.find((r) => r.name === "captions vs voice (word sync)")?.score).toBe(9.5);
    expect(rows.find((r) => r.name === "sampled frames")?.score).toBe(9);
    expect(finalChecks({ craft: 9, findings: [], shotScores: [9] }).some((r) => r.name === "sampled frames")).toBe(false);
  });
});

import { timedCues } from "@/lib/video-post";
import { layoutCopy } from "@/lib/caption-layout";
it("captions follow the spoken span, not the whole shot", () => {
  const cues = timedCues([{ start: 7, end: 11, text: "Your favorite cola, made merry, with just fifty calories.", speech: { start: 7.15, end: 10.6 } }]);
  expect(cues[0].start).toBeCloseTo(7.15, 2);
  expect(cues.at(-1)!.end).toBeLessThanOrEqual(10.6 + 1e-6);
  expect(timedCues([{ start: 0, end: 3, text: "Love cola, dread the sugar guilt?" }]).at(-1)!.end).toBeCloseTo(3, 2);
});
it("captions sit under a top overlay instead of the lower third", () => {
  const seg = [{ start: 0, end: 3, text: "Love cola, dread the sugar guilt?", onScreen: "Classic cola ritual. 5g sugar." }];
  const { captions, overlays } = layoutCopy(null, 486, 864, seg, timedCues(seg), { caption: 30, overlay: 24 });
  expect(overlays[0].y).toBeLessThanOrEqual(0.3);
  expect(captions[0].y).toBeLessThan(0.5);
});
