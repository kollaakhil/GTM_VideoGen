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
