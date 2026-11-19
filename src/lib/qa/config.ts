import type { StageId } from "../types";

/**
 * QA is three checks (PLAYBOOK 14.x), not a gate at every stage:
 *   (a) the shot sheet gate  - free, deterministic, before anything renders (src/lib/sheet/gate.ts);
 *   (b) one cheap check per preview shot (src/lib/qa/shot-check.ts);
 *   (c) one strict final review, median of 3, Final only (src/lib/qa/final-review.ts).
 * The older per-stage gates stay in the code behind QA_GATES=legacy. Browser-safe: reads NEXT_PUBLIC_ vars like gate-config.ts.
 */
export type GateMode = "consolidated" | "legacy";

export interface QaGates {
  mode: GateMode;
  /** Independent reviews whose median decides the final. Odd, 1..7. */
  finalReviews: number;
  /** Stage gates that still block the flow. */
  enabled: Record<StageId, boolean>;
}

/** Stages that stay on in consolidated mode: the free, deterministic ones that stop paid waste (voice length) or are the final itself. */
const KEEP: StageId[] = ["script", "voice", "final"];
const STAGES: StageId[] = ["research", "brief", "script", "shots", "voice", "video", "audio", "edit", "final"];

export function qaGates(env: Record<string, string | undefined> = process.env): QaGates {
  const mode: GateMode = (env.NEXT_PUBLIC_QA_GATES ?? env.QA_GATES) === "legacy" ? "legacy" : "consolidated";
  const n = Math.round(Number(env.NEXT_PUBLIC_QA_FINAL_REVIEWS ?? env.QA_FINAL_REVIEWS) || 3);
  const finalReviews = Math.max(1, Math.min(7, n % 2 ? n : n + 1));
  const enabled = Object.fromEntries(STAGES.map((s) => [s, mode === "legacy" || KEEP.includes(s)])) as Record<StageId, boolean>;
  return { mode, finalReviews, enabled };
}

export const gateEnabled = (stage: StageId, env?: Record<string, string | undefined>) => qaGates(env).enabled[stage];
