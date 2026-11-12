import { describe, expect, it } from "vitest";
import { checkScript, finalScore, judgeFor, sameHooks, textMatch, textRecall } from "@/lib/script-lab";
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
    expect(checkScript(base, 10, ["Ships across Texas"])).toEqual(['Missing or shortened must-say; use it word for word: "Ships across Texas".']);
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

  it("matches spoken numbers, prices and transcription spelling drift", () => {
    expect(textMatch("Hosting a home haldi? We rented this—$299.", "Hosting a home holdi. We rented this, two ninety-nine dollars.")).toBe(1);
    expect(textMatch("Rent for $249 a weekend", "Rent for two hundred forty nine a weekend")).toBe(1);
    expect(textMatch("Request your date", "Request your data")).toBeGreaterThan(0.6);
    expect(textMatch("Rent for $249", "Rent for $299")).toBeLessThan(1);
  });

  it("textRecall scores a shot line inside a wider transcript window", () => {
    expect(textRecall("we rented this two ninety nine get price and ship confirmation", "Hosting a home haldi? We rented this—$299.")).toBe(0.5);
    expect(textRecall("hosting a home haldi we rented this 299 get price", "Hosting a home haldi? We rented this—$299.")).toBe(1);
  });
});

describe("sameHooks", () => {
  const mk = (id: string, spoken: string, overall: number): AdScript => ({
    id, framework: "x", hook: { visual: "", spoken, onScreen: "" }, beats: [], cta: "",
    score: { overall, scores: {}, notes: [], unsupported: [], panel: { stopRate: 5, quotes: [] } }, checks: [],
  });
  it("flags the weaker of two hooks that open the same way", () => {
    const d = sameHooks([mk("a", "Hands full and running late?", 8), mk("b", "Hands full, still fighting laces?", 7), mk("c", "Full price? I waited.", 7)]);
    expect([...d]).toEqual(["b"]);
  });
});

describe("judgeFor", () => {
  it("never lets a model grade its own scripts", () => {
    expect(judgeFor("google/gemini-4-carbon", "anthropic/claude-sonnet-5.5")).toBe("anthropic/claude-sonnet-5.5");
    expect(judgeFor("openai/gpt-6.1-sol", "openai/gpt-6.1-sol")).toBe("anthropic/claude-sonnet-5.5");
    expect(judgeFor("anthropic/claude-sonnet-5.5", "anthropic/claude-sonnet-5.5")).toBe("openai/gpt-6.1-sol");
  });
});
