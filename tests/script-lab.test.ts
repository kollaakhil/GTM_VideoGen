import { describe, expect, it } from "vitest";
import { checkScript, finalScore, textMatch } from "@/lib/script-lab";
import type { AdScript } from "@/lib/types";

const base: AdScript = {
  id: "sc_0",
  framework: "Before → after",
  hook: { visual: "Bare living room", spoken: "Your haldi backdrop, done in an hour", onScreen: "Haldi in 1 hour" },
  beats: [
    { seconds: 3, visual: "Bare wall", vo: "Your haldi backdrop, done in an hour.", onScreen: "Haldi in 1 hour" },
    { seconds: 4, visual: "Kit unboxed", vo: "Marigold drapes and brass urlis, ready to hang.", onScreen: "Everything included" },
    { seconds: 3, visual: "Family photo", vo: "Request your date today.", onScreen: "Request your date" },
  ],
  cta: "Request your date",
};

describe("checkScript", () => {
  it("passes a well-timed script with a CTA", () => {
    expect(checkScript(base, 10)).toEqual([]);
  });
  it("flags lines too long to read aloud, wrong length and a missing CTA", () => {
    const s = structuredClone(base);
    s.beats[1].vo = "This is a far too long line that nobody could possibly say in four seconds out loud at all";
    s.beats[2].vo = "See you soon.";
    s.beats[2].onScreen = "";
    const issues = checkScript(s, 20);
    expect(issues.some((i) => i.includes("Beat 2"))).toBe(true);
    expect(issues.some((i) => i.includes("target is 20s"))).toBe(true);
    expect(issues.some((i) => i.includes("CTA"))).toBe(true);
  });
  it("flags missing must-say items", () => {
    expect(checkScript(base, 10, ["Ships across Texas"])).toEqual(['Missing must-say: "Ships across Texas".']);
    expect(checkScript(base, 10, ["brass urlis"])).toEqual([]);
  });
});

describe("textMatch", () => {
  it("scores identical speech as 1 and ignores case and punctuation", () => {
    expect(textMatch("Request your date, today!", "request your date today")).toBe(1);
  });
  it("drops when words are missing or changed", () => {
    expect(textMatch("Request your date", "Request your date today")).toBe(0.75);
    expect(textMatch("Buy now", "Request your date today")).toBe(0);
  });
});

describe("finalScore", () => {
  it("keeps scripts with failed checks below the pass bar", () => {
    const s = { ...base, score: { overall: 9, scores: {}, notes: [], unsupported: [], panel: { stopRate: 7, quotes: [] } }, checks: ["Runs 20s"] };
    expect(finalScore(s)).toBe(7);
    expect(finalScore({ ...s, checks: [] })).toBe(9);
  });
});
