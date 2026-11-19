import { cached, type CacheStore, inputHash } from "../render/cache";
import { runParallel } from "../render/scheduler";

/** Check (b): one cheap look per preview shot. Exactly one model call per shot, on one frame from the middle of the clip. */
export interface PreviewShot {
  id: string;
  /** What the sheet says happens (the reviewer judges this against the frame). */
  expected: string;
  /** Content or URL of the rendered clip; part of the cache key. */
  clip: string;
}

export interface ShotVerdict { score: number; note: string; pass: boolean; cached: boolean }

export interface ShotCheckDeps {
  /** One frame from the clip, taken at `at` seconds. */
  frame: (clip: string, at: number) => Promise<string>;
  review: (frame: string, expected: string) => Promise<{ score: number; notes: string[] }>;
}

export const SHOT_PASS = 7;

export async function checkPreviewShots(shots: (PreviewShot & { seconds: number })[], deps: ShotCheckDeps, o: { cache?: CacheStore<ShotVerdict>; model?: string; limit?: number } = {}): Promise<Record<string, ShotVerdict>> {
  const res = await runParallel(shots.map((s) => ({
    id: s.id, stage: "shot-check",
    // Unchanged clip and expectation: no second judge call.
    key: inputHash("shot-check-v1", o.model ?? "", s.clip, s.expected, s.seconds),
    run: async (): Promise<ShotVerdict> => {
      const frame = await deps.frame(s.clip, Number((s.seconds / 2).toFixed(3)));
      const r = await deps.review(frame, s.expected);
      const score = Math.max(0, Math.min(10, r.score));
      return { score, note: r.notes.join(" ").slice(0, 300), pass: score >= SHOT_PASS, cached: false };
    },
  })), { limit: o.limit ?? 4, retries: 1, cache: o.cache, persist: (v) => !/could not/i.test(v.note) });
  return Object.fromEntries(res.map((r, i) => [shots[i].id, r.status === "failed"
    ? { score: 0, note: `The check could not run: ${r.error?.message ?? "unknown error"}`, pass: false, cached: false }
    : { ...r.value!, cached: r.status === "cached" }]));
}

export { cached };
