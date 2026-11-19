/**
 * Fast preview QA (playbook 13.37). A preview draft is for iterating, so it pays for one cheap check per shot and
 * one craft review of the cut; the full stack (frame-by-frame vision QA, median-of-N export reviews) runs only on
 * the Final video. A run can opt back into full QA on drafts with `videoPlan.fullDraftQa`.
 */
export type QaMode = "preview" | "full";

export function qaMode(tier: "draft" | "final", plan?: { fullDraftQa?: boolean } | null): QaMode {
  return tier === "final" || plan?.fullDraftQa ? "full" : "preview";
}

/** Independent export reviews per shot: none in preview (the per-shot check stands), `full` reviews on Final. */
export function exportReviewCount(mode: QaMode, full: number): number {
  return mode === "full" ? full : 0;
}

/** Times to sample for a shot's vision check: one mid-shot frame in preview, the full spread otherwise. */
export function shotCheckTimes(mode: QaMode, start: number, end: number, spread: (s: number, e: number) => number[]): number[] {
  return mode === "preview" ? [Number(((start + end) / 2).toFixed(3))] : spread(start, end);
}
