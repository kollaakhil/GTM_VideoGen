import type { JobProgress } from "@/lib/types";

/** Typical seconds per stage, used for ETAs until real timings exist. */
const TYPICAL_SHOT_SEC = 75;

export const fmtSec = (sec: number) => sec >= 60 ? `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s` : `${Math.max(1, Math.round(sec))}s`;

/** Overall job percent and ETA plus one bar per shot with its stage, percent and ETA, from the persisted job status. */
export function jobView(job: JobProgress, nowMs: number) {
  const started = job.startedAt ? Date.parse(job.startedAt) : nowMs;
  const elapsed = Math.max(0, (nowMs - started) / 1000);
  const finished = (job.shots ?? []).filter((s) => s.endedAt && s.startedAt);
  const perShot = finished.length ? finished.reduce((t, s) => t + (Date.parse(s.endedAt!) - Date.parse(s.startedAt!)) / 1000, 0) / finished.length : TYPICAL_SHOT_SEC;
  const shots = (job.shots ?? []).map((s) => {
    const run = s.startedAt ? (nowMs - Date.parse(s.startedAt)) / 1000 : 0;
    const pct = s.stage === "done" ? 100 : s.stage === "queued" ? 0 : s.stage === "failed" ? 100
      : s.stage === "qa" ? 92 : Math.min(90, Math.round((run / perShot) * 90));
    const eta = s.stage === "done" || s.stage === "failed" ? 0 : s.stage === "queued" ? null : Math.max(5, perShot - run);
    return { ...s, pct, eta };
  });
  const pct = job.total ? Math.min(99, Math.round(((job.done + (shots.find((s) => s.stage === "rendering" || s.stage === "qa" || s.stage === "upscaling")?.pct ?? 0) / 100) / job.total) * 100)) : 2;
  const eta = job.done > 0 && pct > 3 ? (elapsed / pct) * (100 - pct) : null;
  return { pct, eta, elapsed, shots };
}

