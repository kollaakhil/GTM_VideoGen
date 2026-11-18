"use client";

import { Gauge, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { scriptStage, STAGES, stageKey } from "@/lib/stage-policy";
import type { StageScore, StudioRun } from "@/lib/types";
import { useFlow } from "./context";

/** The direction whose scores the strip shows: the most recently scored one. */
function focusDirection(run: StudioRun) {
  let best: { id: string; at: string } | null = null;
  for (const [k, s] of Object.entries(run.stageScores ?? {})) {
    const id = k.split(":")[1];
    if (id && (!best || s.at > best.at)) best = { id, at: s.at };
  }
  return run.directions.find((d) => d.id === best?.id) ?? run.directions.find((d) => d.approvedScript) ?? null;
}

/** One chip per stage with its score; a stage under its bar blocks the next step until fixed or overridden. */
export function QualityGates() {
  const { run, act, sending } = useFlow();
  if (!run?.research) return null;
  const d = focusDirection(run);
  const scores: (StageScore | null)[] = STAGES.map((s) =>
    s.id === "script" ? scriptStage(d?.approvedScript ?? null) : run.stageScores?.[stageKey(s.id, d?.id)] ?? null);
  const override = (s: StageScore) => {
    const reason = window.prompt(`Override the ${s.stage} gate at ${s.score}/10? Say why (kept on the run):`);
    if (reason && reason.trim().length >= 3) act("override_stage", { runId: run.id, key: stageKey(s.stage, d?.id), reason: reason.trim() });
  };
  return (
    <div className="pointer-events-auto flex max-w-3xl flex-wrap items-center gap-1.5 rounded-xl border border-white/10 bg-zinc-900/90 px-2 py-1.5 text-[11px] backdrop-blur-xl">
      <Gauge className="size-3.5 text-zinc-500" />
      {STAGES.map((st, i) => {
        const s = scores[i];
        const ok = s && (s.pass || s.override);
        const tip = s
          ? `${st.label}: ${s.score}/10 (needs ${st.threshold}${s.raw !== s.score ? `, raw ${s.raw} before judge calibration` : ""}; ${s.attempts} attempt${s.attempts === 1 ? "" : "s"}, ${s.judge})\n${s.checks.map((c) => `• ${c.name}: ${c.score}${c.note ? ` (${c.note})` : ""}`).join("\n")}${s.notes.length ? `\nFix: ${s.notes.join(" ")}` : ""}${s.override ? `\nOverridden by ${s.override.by}: ${s.override.reason}` : ""}`
          : `${st.label}: not scored yet (needs ${st.threshold})`;
        return (
          <span key={st.id} title={tip} className={cn("flex items-center gap-1 rounded-md px-1.5 py-0.5 tabular-nums", !s ? "bg-white/5 text-zinc-500" : ok ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300")}>
            {st.label} {s ? `${s.score}` : "–"}
            {s?.override && <ShieldCheck className="size-3" />}
            {s && !ok && st.id !== "script" && (
              <button type="button" disabled={sending} onClick={() => override(s)} className="ml-0.5 underline decoration-dotted hover:text-white">override</button>
            )}
          </span>
        );
      })}
      <button type="button" disabled={sending} onClick={() => act("calibrate_judges", { runId: run.id })} className="ml-auto rounded-md px-1.5 py-0.5 text-zinc-400 hover:bg-white/5 hover:text-white" title="Score the labeled golden set with the gate judge, log disagreements and correct its bias (about $0.03)">
        Calibrate judges
      </button>
    </div>
  );
}
