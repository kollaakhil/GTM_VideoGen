"use client";

import { fmtSec } from "@/lib/job-progress";
import { summarizeTimings } from "@/lib/render/timing";
import type { StudioRun } from "@/lib/types";

const LABEL: Record<string, string> = {
  shot: "Shots (end to end)", render: "Rendering", "shot-check": "Per-shot check", edit: "Edit and mix", captions: "Captions",
  "audio-qa": "Audio checks", "final-review": "Final review",
};

/** Where the time of the last render went. "Wall" is the clock time; shots that ran in parallel make it shorter than the sum. */
export function StageTimings({ run }: { run: Pick<StudioRun, "timings"> }) {
  const rows = summarizeTimings(run.timings ?? []);
  if (!rows.length) return null;
  return (
    <details className="rounded-md border border-white/10 bg-zinc-950/60 p-2 text-[10px] text-zinc-400" aria-label="Stage timings">
      <summary className="cursor-pointer text-zinc-300">Where the time went</summary>
      <div className="mt-1.5 grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
        <span className="text-zinc-500">Stage</span><span className="text-right text-zinc-500">Wall</span><span className="text-right text-zinc-500">Sum</span>
        {rows.map((r) => (
          <div key={r.stage} className="contents">
            <span className="truncate">{LABEL[r.stage] ?? r.stage}{r.count > 1 ? ` ×${r.count}` : ""}{r.cached ? ` · ${r.cached} cached` : ""}{r.failed ? ` · ${r.failed} failed` : ""}</span>
            <span className="text-right text-zinc-200">{fmtSec(r.wallMs / 1000)}</span>
            <span className="text-right">{fmtSec(r.totalMs / 1000)}</span>
          </div>
        ))}
      </div>
    </details>
  );
}
