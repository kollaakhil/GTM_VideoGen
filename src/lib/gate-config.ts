import type { StageId } from "./types";

/**
 * Gate thresholds. Every stage defaults to 8/10; shot renders and final QA default to the 9/10 publish bar.
 * Override per stage with NEXT_PUBLIC_GATE_THRESHOLDS="script=8.5,video=9" (NEXT_PUBLIC so the step UI and the
 * server agree; it is inlined at build time, so rebuild after changing it).
 */
export const DEFAULT_THRESHOLD = 8;
export const PUBLISH_BAR = 9;
const DEFAULTS: Record<StageId, number> = {
  research: DEFAULT_THRESHOLD, brief: DEFAULT_THRESHOLD, script: DEFAULT_THRESHOLD, shots: DEFAULT_THRESHOLD,
  voice: DEFAULT_THRESHOLD, video: PUBLISH_BAR, audio: DEFAULT_THRESHOLD, edit: DEFAULT_THRESHOLD, final: PUBLISH_BAR,
};

export function parseThresholds(raw = ""): Record<StageId, number> {
  const out = { ...DEFAULTS };
  for (const part of raw.split(/[,;]/)) {
    const [k, v] = part.split("=").map((x) => x?.trim());
    const n = Number(v);
    if (k && k in out && Number.isFinite(n) && n >= 0 && n <= 10) out[k as StageId] = n;
  }
  return out;
}

export const GATE_THRESHOLDS = parseThresholds(process.env.NEXT_PUBLIC_GATE_THRESHOLDS ?? "");
