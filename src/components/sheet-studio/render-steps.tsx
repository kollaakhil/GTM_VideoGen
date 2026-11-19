"use client";

import { Button } from "@/components/ui/button";
import type { SheetRun } from "@/lib/sheet/run-types";
import type { VersionStack } from "@/lib/versions";
import { secs, usd } from "./api";
import { VersionsPanel } from "./versions-panel";

/** Steps 4 and 5. Previews render every shot cheaply (720p) per version; Final renders the winner at full quality. */
export function RenderSteps({ run, view, busy, act }: { run: SheetRun; view: "previews" | "final"; busy: boolean; act: (b: Record<string, unknown>) => Promise<unknown> }) {
  if (view === "previews") {
    const handleStartVersions = async (stacks: VersionStack[]) => {
      await act({ action: "start_versions", runId: run.id, stacks });
    };

    const handlePickWinner = async (versionId: string) => {
      await act({ action: "pick_winner", runId: run.id, versionId });
    };

    return (
      <div className="space-y-6" data-testid="previews-step">
        <VersionsPanel
          run={run}
          busy={busy}
          onStartVersions={handleStartVersions}
          onPickWinner={handlePickWinner}
        />
      </div>
    );
  }
  return (
    <div className="space-y-3" data-testid="final-step">
      {(() => { const w = run.versions.find((v) => v.id === run.picks?.video); return <div className="text-sm text-zinc-400">{w ? <>Final renders <b className="text-zinc-200">{w.stack.label}</b> at full quality, then runs the strict review (median of 3).</> : "Pick a winner on Previews first (otherwise the best-scored preview is used)."}</div>; })()}
      <Button disabled={busy || !run.versions.some((v) => v.status === "done")} onClick={() => act({ action: "final", runId: run.id })}>Render final</Button>
      {run.final && (
        <div className="max-w-3xl space-y-2">
          <video src={run.final.videoUrl} controls className="w-full rounded" />
          <div className="text-sm" data-testid="final-score">Final score <b>{run.final.score ?? "—"}</b>/10 (median of {run.final.reviews?.length ?? 0} reviews) · {usd(run.final.usd)} · {secs(run.final.ms)}</div>
          {run.final.notes?.length ? <ul className="list-disc pl-5 text-xs text-zinc-400">{run.final.notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : null}
        </div>
      )}
    </div>
  );
}
