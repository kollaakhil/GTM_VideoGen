import { describe, expect, it } from "vitest";
import { medianReview } from "@/lib/video-plan";
import type { ShotQA } from "@/lib/types";

const qa = (score: number, note: string): ShotQA => ({ score, match: score >= 8 ? "pass" : "fail", notes: [note] });

describe("medianReview", () => {
  it("keeps the middle review whole, not the best or worst", () => {
    const m = medianReview([qa(10, "clean"), qa(4, "label drift"), qa(9, "fine")]);
    expect(m.score).toBe(9);
    expect(m.notes[0]).toBe("fine");
    expect(m.notes.at(-1)).toMatch(/Median of 3 reviews \(scores 10, 4, 9\)/);
  });
  it("still fails a flaw two of three reviewers see", () => {
    expect(medianReview([qa(10, "ok"), qa(3, "cropped"), qa(4, "cropped")]).match).toBe("fail");
  });
});
