import { VIDEO_PASS } from "./quality-policy";
import type { AdScript, JudgeCalibration, StageId, StageScore, StudioRun, VideoTake } from "./types";

/**
 * Quality compounds, so every stage has its own scored gate: research, script, shot instructions, video,
 * sound/voice and the edit. Each gate mixes deterministic checks with one cheap judge call, retries once with the
 * judge's notes where a retry is cheap, and blocks the next step under its threshold unless a human overrides.
 * Pure helpers only (the UI imports this); judges live in stage-gates.ts.
 */
export const STAGES: { id: StageId; label: string; threshold: number }[] = [
  { id: "research", label: "Research", threshold: 8 },
  { id: "script", label: "Script", threshold: 7 },
  { id: "shots", label: "Shot plan", threshold: 8 },
  { id: "video", label: "Video", threshold: VIDEO_PASS },
  { id: "audio", label: "Sound & voice", threshold: 8 },
  { id: "edit", label: "Edit", threshold: 8 },
];
export const threshold = (stage: StageId) => STAGES.find((s) => s.id === stage)!.threshold;

export type Check = StageScore["checks"][number];

export const clamp = (n: number) => Math.max(0, Math.min(10, Math.round(n * 10) / 10));

/** Weighted mean of checks; any check at 3 or below caps the stage at 6 (one broken dimension sinks the stage). */
export function combine(checks: Check[]) {
  const total = checks.reduce((s, c) => s + (c.weight ?? 1), 0) || 1;
  const mean = checks.reduce((s, c) => s + c.score * (c.weight ?? 1), 0) / total;
  return clamp(checks.some((c) => c.score <= 3) ? Math.min(6, mean) : mean);
}

/**
 * Judge calibration: if a judge over-scored known-bad golden items, subtract that inflation so its scores mean
 * the same as a human label. Never adds points.
 */
export function calibrated(raw: number, judge: string, cal?: JudgeCalibration | null, kind?: string) {
  const row = cal?.judges.find((j) => j.judge === judge && (!kind || j.kind === kind));
  return clamp(raw - Math.max(0, row?.inflation ?? 0));
}

export function stageScore(stage: StageId, checks: Check[], judge: string, attempts: number, notes: string[] = [], cal?: JudgeCalibration | null): StageScore {
  const raw = combine(checks);
  const judged = checks.some((c) => c.by === "judge");
  const score = judged ? calibrated(raw, judge, cal, stage) : raw;
  return { stage, score, raw, pass: score >= threshold(stage), checks, notes: notes.slice(0, 6), attempts, judge: judged ? judge : "rules", override: null, at: new Date().toISOString() };
}

export const stageKey = (stage: StageId, directionId?: string) => (directionId && stage !== "research" ? `${stage}:${directionId}` : stage);

export function saveStage(run: StudioRun, s: StageScore, directionId?: string) {
  run.stageScores = { ...(run.stageScores ?? {}), [stageKey(s.stage, directionId)]: s };
}

/** The reason a stage blocks the next step, or null when it passed or a human overrode it. Unscored stages don't block. */
export function stageBlock(run: Pick<StudioRun, "stageScores">, stage: StageId, directionId?: string) {
  const s = run.stageScores?.[stageKey(stage, directionId)];
  if (!s || s.pass || s.override) return null;
  const label = STAGES.find((x) => x.id === stage)!.label;
  return `${label} scored ${s.score}/10 (needs ${threshold(stage)}). Fix it, or override the ${label.toLowerCase()} gate to continue.`;
}


/** Video, sound and edit scores of one take; an override on the direction's stage (stage:directionId) lets it through. */
export function takeStageBlock(run: Pick<StudioRun, "stageScores">, directionId: string, take: Pick<VideoTake, "stages">) {
  for (const s of take.stages ?? []) {
    if (s.pass || run.stageScores?.[stageKey(s.stage, directionId)]?.override) continue;
    const label = STAGES.find((x) => x.id === s.stage)!.label;
    return `${label} scored ${s.score}/10 on this take (needs ${threshold(s.stage)}). Make another take, or override the ${label.toLowerCase()} gate.`;
  }
  return null;
}

/** Records a human override on a scored stage. */
export function overrideStage(run: StudioRun, key: string, by: string, reason: string) {
  const s = run.stageScores?.[key];
  if (!s) return false;
  run.stageScores = { ...run.stageScores, [key]: { ...s, override: { by, at: new Date().toISOString(), reason: reason.slice(0, 300) } } };
  return true;
}

/** Script stage score from the existing independent script review (the script lab already loops to SCRIPT_TARGET). */
export function scriptStage(s?: AdScript | null): StageScore | null {
  if (!s?.score) return null;
  const checks: Check[] = Object.entries(s.score.scores).map(([name, score]) => ({ name, score, note: "", by: "judge" as const }));
  checks.push({ name: "overall", score: s.score.overall, note: s.score.notes?.[0] ?? "", by: "judge", weight: 3 });
  return { ...stageScore("script", checks, s.review?.judge ?? "judge", s.rounds ?? 1, s.score.notes ?? []), score: s.score.overall, raw: s.score.overall, pass: s.score.overall >= threshold("script") && !s.score.unsupported.length };
}

