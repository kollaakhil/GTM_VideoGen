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
    expect(beatFitProblem("Half off two-plus cases. Shop at drinkolipop.com.", 4)).toBeNull();
    expect(spokenSeconds("")).toBe(0);
    expect(spokenSeconds("Fifty percent off two-plus cases. Shop at drinkolipop.com.")).toBeCloseTo(0.25 + 17 / 4.6 + 0.2, 2);
  });
});
