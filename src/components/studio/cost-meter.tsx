"use client";

import { useState } from "react";
import { DEFAULT_CAP_USD } from "@/lib/render/cap";
import { cn } from "@/lib/utils";
import type { StudioRun } from "@/lib/types";
import { useFlow } from "./context";

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Pure view of the meter: spent, held for calls in flight, and the cap. Safe to render anywhere with a run. */
export function MeterBar({ run, onCap, busy }: { run: Pick<StudioRun, "costUsd" | "capUsd" | "meter">; onCap?: (usd: number) => void; busy?: boolean }) {
  const cap = run.meter?.capUsd ?? run.capUsd ?? DEFAULT_CAP_USD;
  const spent = run.meter?.spentUsd ?? run.costUsd ?? 0;
  const held = run.meter?.reservedUsd ?? 0;
  const pct = (n: number) => `${Math.min(100, Math.max(0, (n / cap) * 100))}%`;
  const state = (spent + held) / cap >= 1 ? "blocked" : (spent + held) / cap >= 0.8 ? "warn" : "ok";
  const [draft, setDraft] = useState("");
  return (
    <div className="space-y-1 rounded-md border border-white/10 bg-zinc-950/60 p-2" role="meter" aria-label="Run spend" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={spent}>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-zinc-300">Run cost</span>
        <span className={cn("tabular-nums", state === "blocked" ? "text-red-300" : state === "warn" ? "text-amber-300" : "text-zinc-200")}>
          {usd(spent)}{held > 0 ? <span className="text-zinc-500"> + {usd(held)} in flight</span> : null} of {usd(cap)} cap
        </span>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className={cn("absolute inset-y-0 left-0 rounded-full transition-all", state === "blocked" ? "bg-red-400" : state === "warn" ? "bg-amber-300" : "bg-emerald-400")} style={{ width: pct(spent) }} />
        <div className="absolute inset-y-0 rounded-full bg-white/30 transition-all" style={{ left: pct(spent), width: pct(held) }} />
      </div>
      {state === "blocked" && <div className="text-[10px] text-red-300">Cap reached: paid steps are blocked until you raise it.</div>}
      {onCap && (
        <form className="flex items-center gap-1 text-[10px] text-zinc-500" onSubmit={(e) => { e.preventDefault(); const n = Number(draft); if (n >= 0.5) { onCap(n); setDraft(""); } }}>
          <label htmlFor="run-cap">Cap $</label>
          <input id="run-cap" inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={cap.toFixed(2)} className="w-14 rounded border border-white/10 bg-zinc-950 px-1 py-0.5 text-zinc-300" />
          <button type="submit" disabled={busy || !(Number(draft) >= 0.5)} className="rounded border border-white/10 px-1.5 py-0.5 text-zinc-300 disabled:opacity-40">Set</button>
        </form>
      )}
    </div>
  );
}

/** The Studio's live meter: reads the run (polled while a job works) and sets the cap through the server. */
export function CostMeter() {
  const { run, act, sending } = useFlow();
  if (!run) return null;
  return <MeterBar run={run} busy={sending} onCap={(capUsd) => act("set_cap", { runId: run.id, capUsd })} />;
}
