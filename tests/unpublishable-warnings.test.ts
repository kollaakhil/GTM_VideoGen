import { describe, expect, it } from "vitest";
import { checkScript, renderedTextProblem, scriptFixNotes, betterScript } from "@/lib/script-lab";
import { checklistScore } from "@/lib/video-plan";
import { asrVocabulary } from "@/lib/media-qa";
import { shotReady } from "@/lib/quality-policy";
import type { AdScript } from "@/lib/types";

/** The four warnings that kept the OLIPOP final (run_41d310961d3e) unpublishable, each traced to a root cause. */
describe("OLIPOP unpublishable warnings", () => {
  it("1+4. flags script beats that need the video model to draw a screen or words (garbled phone UI, video gate 4/10)", () => {
    const hook = "Beside empty holiday coupe glasses, a thumb taps an OLIPOP Pomegranate Sparkle page showing Out of Stock and Notify Me.";
    expect(renderedTextProblem(hook)).toMatch(/readable text or a screen/);
    expect(renderedTextProblem("A hand sets a chilled OLIPOP can beside a halved pomegranate.")).toBeNull();
    expect(renderedTextProblem('A chalkboard sign that says "Open"')).not.toBeNull();
    expect(renderedTextProblem("She scrolls her phone screen on the couch.")).not.toBeNull();
    const s = {
      id: "s", framework: "Buyer friction", cta: "Shop now", hook: { visual: hook, spoken: "Sold out!", onScreen: "Limited" },
      beats: [{ seconds: 3, visual: hook, vo: "Sold out!", onScreen: "Limited" }, { seconds: 4, visual: "Two glasses clink.", vo: "Shop now.", onScreen: "Shop now" }],
    } as AdScript;
    expect(checkScript(s, 7).some((c) => c.startsWith("Beat 1:") && /screen/.test(c))).toBe(true);
  });

  it("2. script repair gets every fix note, not just the judge's single blocker beat", () => {
    const s = {
      checks: ["Beat 1: no screens"], score: { overall: 6, scores: {}, notes: ["Add the 4g total sugars disclosure."], unsupported: [],
        proofProblems: ["The opening establishes the stock obstacle before the goal.", "“Tap Notify Me for this pour” contradicts the pour."], panel: { stopRate: 0, quotes: [] } },
    } as unknown as AdScript;
    const notes = scriptFixNotes(s);
    expect(notes).toHaveLength(4);
    expect(notes.join(" ")).toContain("Tap Notify Me");
    const fixed = { ...s, checks: [], score: { ...s.score!, overall: 8, proofProblems: [], notes: [] } } as AdScript;
    expect(betterScript(fixed, s)).toBe(true);
    const worse = { ...fixed, score: { ...fixed.score!, unsupported: ["Best soda ever"] } } as AdScript;
    expect(betterScript(worse, s)).toBe(false);
  });

  it("3. keyframes are scored from findings: a clean checklist reaches 9+, a real defect does not", () => {
    // OLIPOP: every keyframe was "pass" on every frame with notes like "accurately reflects…", yet scored 7 → blocked forever.
    const clean = [{ at: 0, match: "pass" as const, note: "", checks: { action: "ok" as const, product: "ok" as const, label: "ok" as const, hands: "ok" as const, artifacts: "ok" as const, framing: "ok" as const } }];
    expect(checklistScore(clean).score).toBe(10);
    expect(shotReady({ score: checklistScore(clean).score, match: "pass", notes: [], frames: clean })).toBe(true);
    const oneMinor = [{ ...clean[0], checks: { ...clean[0].checks, label: "minor" as const } }];
    expect(checklistScore(oneMinor).score).toBe(9);
    const twoMinor = [{ ...clean[0], checks: { ...clean[0].checks, label: "minor" as const, hands: "minor" as const } }];
    expect(checklistScore(twoMinor).score).toBe(8);
    // Known-bad: melting label on one frame (OLIPOP s0: garbled pseudo-text, wrong can art).
    const bad = [clean[0], { at: 1, match: "fail" as const, note: "garbled", checks: { ...clean[0].checks, label: "major" as const, artifacts: "major" as const } }];
    expect(checklistScore(bad).score).toBeLessThanOrEqual(6);
    expect(checklistScore([{ at: 0, match: "fail" as const, note: "wrong product" }]).score).toBeLessThanOrEqual(6);
  });

  it("speech check hints coined brand words and domains to whisper, not the whole line", () => {
    expect(asrVocabulary("Get notified at drinkolipop.com.", "OLIPOP")).toBe("OLIPOP, drinkolipop.com");
    expect(asrVocabulary("Skip heavy sugar.", "")).toBe("");
  });
});
