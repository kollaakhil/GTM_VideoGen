import { describe, expect, it } from "vitest";
import { beatFitProblem, numberWords, spokenForm, spokenSeconds, syllables } from "@/lib/speech-budget";

describe("speech budget", () => {
  it("expands numbers, %, + and domains", () => {
    expect(numberWords(50)).toBe("fifty");
    expect(spokenForm("50% off 2+ cases at drinkolipop.com")).toBe("fifty percent off two plus cases at drinkolipop dot com");
  });
  it("counts syllables close to speech", () => {
    expect(syllables("Love cola, dread the sugar guilt?")).toBe(8);
    expect(syllables("Fifty percent off two-plus cases. Shop at drinkolipop.com.")).toBe(17);
  });
  it("matches the measured run_8a9c7c9db627 voice lines", () => {
    // measured: 2.46s, 2.09s, 3.47s fit 3/4/4s beats; 4.21s needed ×1.14 in a 4s beat
    expect(beatFitProblem("Love cola, dread the sugar guilt?", 3)).toBeNull();
    expect(beatFitProblem("Keep the cola, swap in OLIPOP.", 4)).toBeNull();
    expect(beatFitProblem("Your favorite cola, made merry, with just fifty calories.", 4)).toBeNull();
    expect(beatFitProblem("Fifty percent off two-plus cases. Shop at drinkolipop.com.", 4)).toMatch(/cut it to \d+ syllables/);
    // (the trimmed CTA fit under Turbo; Eleven v3 needs more room for it, see the 13.30 block below)
    expect(spokenSeconds("")).toBe(0);
    expect(spokenSeconds("Fifty percent off two-plus cases. Shop at drinkolipop.com.")).toBeCloseTo(0.25 + 17 / 4.6 + 0.4 + 0.45, 2);
  });
});

describe("Eleven v3 calibration (13.30)", () => {
  it("rejects the CTA line that v3 read in 4.6 s for a 4 s beat, before any voice is bought", () => {
    expect(beatFitProblem("Half off two-plus cases. Shop at drinkolipop.com.", 4)).toMatch(/takes about 4\.\ds/);
  });
  it("still passes the three lines v3 fit", () => {
    expect(beatFitProblem("Love cola, dread the sugar guilt?", 3)).toBeNull();
    expect(beatFitProblem("Keep the cola, swap in OLIPOP.", 4)).toBeNull();
    expect(beatFitProblem("Your favorite cola, made merry, with just fifty calories.", 4)).toBeNull();
  });
  it("lets the same CTA through when the free packshot beat is lengthened to 5 s", () => {
    expect(beatFitProblem("Half off two-plus cases. Shop at drinkolipop.com.", 5)).toBeNull();
  });
});
