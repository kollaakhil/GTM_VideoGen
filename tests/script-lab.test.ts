import { describe, expect, it } from "vitest";
import { checkScript, finalScore, judgeFor, nearSpeech, sameHooks, sameSpeech, SCRIPT_TARGET, textMatch, textRecall } from "@/lib/script-lab";
import { recommendedOpening, scriptReady, SCRIPT_RUBRIC } from "@/lib/quality-policy";
import { lockScriptShots } from "@/lib/video-plan";
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
  it("doesn't accept shortened mandatory copy or a shortened CTA", () => {
    expect(checkScript(base, 10, ["Request your date with free delivery"])).not.toEqual([]);
    expect(checkScript({ ...base, cta: "Request your date with free delivery" }, 10)).not.toEqual([]);
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
    expect(finalScore(s)).toBe(SCRIPT_TARGET - 1);
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

it("requires independent production checks but has no minimum script score", () => {
  const score = { overall: 7, scores: {}, notes: [], unsupported: [], panel: { stopRate: 8, quotes: [] } };
  const script = { ...base, score, checks: [], review: { rubric: SCRIPT_RUBRIC, writer: "carbon", judge: "sol", targetSeconds: 10 } };
  expect(scriptReady(script)).toBe(true);
  expect(scriptReady({ ...script, score: { ...score, overall: 4 } })).toBe(true);
  expect(scriptReady({ ...script, score: { ...score, unsupported: ["Free"] } })).toBe(false);
  expect(scriptReady({ ...script, checks: ["Missing required wording"] })).toBe(false);
  const oldReview = { ...script.review, rubric: "studio-script-v1" };
  expect(scriptReady({ ...script, review: oldReview, score: { ...score, overall: 8 } })).toBe(true);
  expect(scriptReady({ ...script, review: oldReview, score: { ...score, overall: 9 } })).toBe(true);
  expect(scriptReady({ ...script, review: { ...script.review, judge: "carbon" } })).toBe(false);
  expect(scriptReady({ ...script, review: undefined })).toBe(false);
});

it("recommends the strongest reviewed opening without blockers", () => {
  const hook = { ...base.hook, type: "goal" as const, id: "ready", review: { score: 8, note: "", blockers: [] } };
  const weak = { ...hook, id: "weak", review: { ...hook.review, score: 7 } };
  const blocked = { ...hook, id: "blocked", review: { ...hook.review, score: 10, blockers: ["Unsupported claim"] } };
  expect(recommendedOpening([blocked, weak, hook])).toBe(hook);
  expect(recommendedOpening([blocked])).toBeUndefined();
});

it("locks beat timing, narration, visible copy and expected action into the storyboard", () => {
  const shots = lockScriptShots(base, [{ visual: "Better angle of the bare wall", camera: "push in" }]);
  expect(shots.map(({ seconds, vo, onScreen, expectedVisual }) => ({ seconds, vo, onScreen, visual: expectedVisual }))).toEqual(base.beats);
  expect(shots[0].visual).toBe("Better angle of the bare wall");
});

it("matches transcription punctuation and written prices without tolerating missing or wrong words", () => {
  expect(sameSpeech("Now two hundred forty-nine dollars.", "Now $249")).toBe(true);
  expect(sameSpeech("Now $349", "Now $249")).toBe(false);
  expect(sameSpeech("Get notified at drink olipop dot com.", "Get notified at drinkolipop.com.")).toBe(true);
  expect(sameSpeech("Get notified at drinkolipop.com", "Get notified at drinkolipop.com.")).toBe(true);
  expect(sameSpeech("Get notified at drink lollipop dot com", "Get notified at drinkolipop.com.")).toBe(false);
  expect(sameSpeech("Now $249", "Now $249 with free shipping")).toBe(false);
});

it("voice pre-check tolerates a misheard coined domain but nothing else", () => {
  expect(nearSpeech("Get notified at drinkallapop.com", "Get notified at drinkolipop.com.")).toBe(true);
  expect(nearSpeech("Get notified at drink alla pop dot com", "Get notified at drinkolipop.com.")).toBe(true);
  expect(nearSpeech("Get updates at drinkolipop.com", "Get notified at drinkolipop.com.")).toBe(false);
  expect(nearSpeech("Get notified at sodashop.com", "Get notified at drinkolipop.com.")).toBe(false);
  expect(nearSpeech("Get notified", "Get notified now")).toBe(false);
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
    expect(judgeFor("google/gemini-4-carbon")).toBe("openai/gpt-6.1-sol");
  });
});
