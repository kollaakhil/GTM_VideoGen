import { describe, expect, it } from "vitest";
import { candidateCount, draftEstimate, pickCandidate } from "@/lib/best-of-n";
import { DEFAULT_VIDEO_PLAN } from "@/lib/video-categories";
import type { ShotQA } from "@/lib/types";

const qa = (match: ShotQA["match"], score: number, majors = 0): ShotQA => ({ match, score, notes: [], frames: [{ at: 1, match: majors ? "fail" : "pass", note: "", checks: Object.fromEntries(["hands", "label", "artifacts"].slice(0, majors).map((k) => [k, "major"])) } as never] });

describe("best-of-N 480p candidates", () => {
  it("defaults new plans to 3 and clamps; legacy plans keep 1", () => {
    expect(DEFAULT_VIDEO_PLAN.candidates).toBe(3);
    expect(candidateCount(undefined)).toBe(1);
    expect(candidateCount(9)).toBe(4);
    expect(candidateCount(0)).toBe(1);
  });
  it("picks pass over review over fail, then score, then fewer majors", () => {
    expect(pickCandidate([qa("fail", 9), qa("pass", 8), qa("review", 9)])).toBe(1);
    expect(pickCandidate([qa("pass", 8), qa("pass", 9)])).toBe(1);
    expect(pickCandidate([qa("fail", 5, 2), qa("fail", 5, 1)])).toBe(1);
    expect(pickCandidate([qa("pass", 9), qa("pass", 9)])).toBe(0);
  });
  it("estimates N× motion plus per-candidate QA before spend", () => {
    const e = draftEstimate([{ seconds: 5, perSec: 0.02 }, { seconds: 4, perSec: 0.02 }], 3, 0.2);
    expect(e.motion).toBeCloseTo(0.54);
    expect(e.qa).toBeCloseTo(0.12);
    expect(e.total).toBeCloseTo(0.86);
  });
});
