import type { QualityFinding } from "../types";

/**
 * Check (c): the strict final review. Final only, never on previews. The creative review is the median of N
 * independent looks (default 3, because a single review of one clip scored 10 once and 3 the next: PLAYBOOK 13.29),
 * and three deterministic checks stay on and can only lower the score: loudness, OCR spelling of on-screen text,
 * and Whisper word sync of captions against the voice.
 */
export interface FinalDeps {
  /** One independent review of the finished video. Called `reviews` times. */
  review: () => Promise<{ score: number; notes: string[] }>;
  loudness: () => Promise<{ lufs: number; peak: number } | null>;
  /** OCR read-back of every exact line of on-screen copy. */
  ocr: () => Promise<QualityFinding[]>;
  /** 0..10 word-sync score of captions against the heard words (Whisper), null when there are no captions. */
  sync: () => Promise<number | null>;
}

export interface FinalReport {
  score: number;
  pass: boolean;
  /** The median of the independent reviews, before the deterministic caps. */
  median: number;
  reviews: { score: number; notes: string[] }[];
  rubric: Record<string, number>;
  notes: string[];
}

export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Streaming loudness target for social: about -14 LUFS integrated, true peak under -1 dBTP. */
export const LOUDNESS = { target: -14, tolerance: 2.5, maxPeak: -1 };
export const FINAL_PASS = 9;

export function loudnessScore(l: { lufs: number; peak: number } | null): { score: number; note: string } {
  if (!l) return { score: 5, note: "Loudness could not be measured" };
  const off = Math.abs(l.lufs - LOUDNESS.target);
  const over = Math.max(0, l.peak - LOUDNESS.maxPeak);
  const score = Math.max(0, 10 - Math.max(0, off - LOUDNESS.tolerance) * 1.5 - over * 4);
  return { score: Math.round(score * 10) / 10, note: `${l.lufs.toFixed(1)} LUFS, peak ${l.peak.toFixed(1)} dBTP` };
}

export async function finalReview(deps: FinalDeps, o: { reviews?: number } = {}): Promise<FinalReport> {
  const n = Math.max(1, o.reviews ?? 3);
  const [looks, loud, ocr, sync] = await Promise.all([
    Promise.allSettled(Array.from({ length: n }, () => deps.review())),
    deps.loudness().catch(() => null),
    deps.ocr().catch((): QualityFinding[] => [{ kind: "coverage", at: 0, expected: "On-screen copy read back", observed: "OCR could not run", status: "review" }]),
    deps.sync().catch(() => null),
  ]);
  const reviews = looks.flatMap((l) => (l.status === "fulfilled" ? [{ score: l.value.score, notes: l.value.notes }] : []));
  const notes: string[] = [];
  if (reviews.length < Math.ceil(n / 2)) notes.push(`Only ${reviews.length} of ${n} reviews ran; the final cannot pass without a majority.`);
  const med = reviews.length ? median(reviews.map((r) => r.score)) : 0;
  const copyFails = ocr.filter((f) => f.status === "fail").length;
  const ocrScore = ocr.some((f) => f.kind === "coverage") ? 5 : Math.max(0, 10 - copyFails * 3);
  const l = loudnessScore(loud);
  const rubric: Record<string, number> = { "creative review (median)": med, loudness: l.score, "on-screen spelling (OCR)": ocrScore, ...(sync != null ? { "caption sync (Whisper)": sync } : {}) };
  // Deterministic checks only ever cap the score: broken spelling or a quiet mix sinks the final however the reviewers felt.
  let score = med;
  if (copyFails) { score = Math.min(score, 6); notes.push(`${copyFails} line(s) of on-screen text not read back exactly`); }
  if (l.score < 7) { score = Math.min(score, 7); notes.push(`Loudness: ${l.note}`); }
  if (sync != null && sync < 7) { score = Math.min(score, 7); notes.push(`Captions out of sync with the voice (${sync}/10)`); }
  notes.push(...reviews.flatMap((r) => r.notes).slice(0, 4));
  const rounded = Math.round(score * 10) / 10;
  return { score: rounded, pass: reviews.length >= Math.ceil(n / 2) && rounded >= FINAL_PASS, median: med, reviews, rubric, notes: notes.slice(0, 8) };
}
