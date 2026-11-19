import type { ShotQA } from "./types";

/** Per-shot 480p candidates rendered side by side; vision QA picks the winner and only winners are upscaled. */
export const DEFAULT_CANDIDATES = 3;
export const MAX_CANDIDATES = 4;

/** New plans default to DEFAULT_CANDIDATES; plans saved before best-of-N (no field) keep one candidate so spend never triples silently. */
export const candidateCount = (n: number | undefined) => Math.max(1, Math.min(MAX_CANDIDATES, Math.round(n ?? 1)));

const rank = (q: ShotQA) => (q.match === "pass" ? 2 : q.match === "review" ? 1 : 0);
const majors = (q: ShotQA) => (q.frames ?? []).reduce((n, f) => n + Object.values(f.checks ?? {}).filter((v) => v === "major").length, 0);

/**
 * Best candidate by: verdict (pass > review > fail), then score, then fewer major frame findings, then fewer
 * failing frames. Returns the index.
 */
export function pickCandidate(qas: ShotQA[]): number {
  let best = 0;
  for (let i = 1; i < qas.length; i++) {
    const a = qas[i], b = qas[best];
    const d = rank(a) - rank(b) || a.score - b.score || majors(b) - majors(a)
      || (b.frames ?? []).filter((f) => f.match === "fail").length - (a.frames ?? []).filter((f) => f.match === "fail").length;
    if (d > 0) best = i;
  }
  return best;
}

/** USD for the paid motion in one draft: every missing shot × candidates × seconds × price, plus QA per candidate. */
export function draftEstimate(missing: { seconds: number; perSec: number }[], candidates: number, reserve: number, qaPerCandidate = 0.02) {
  const motion = missing.reduce((t, m) => t + m.seconds * m.perSec * candidates, 0);
  return { motion, qa: missing.length * candidates * qaPerCandidate, reserve, total: motion + missing.length * candidates * qaPerCandidate + reserve };
}
