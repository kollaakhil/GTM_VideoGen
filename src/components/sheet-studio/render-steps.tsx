"use client";

import { Button } from "@/components/ui/button";
import type { SheetRun } from "@/lib/sheet/run-types";
import { secs, usd } from "./api";

/** Steps 4 and 5. Previews render every shot cheaply (720p) per version; Final renders the winner at full quality. */
export function RenderSteps({ run, view, busy, act }: { run: SheetRun; view: "previews" | "final"; busy: boolean; act: (b: Record<string, unknown>) => Promise<unknown> }) {
  if (view === "previews") {
    return (
      <div className="space-y-3" data-testid="previews-step">
        <div className="flex items-center gap-2">
          <Button disabled={busy || !run.gate?.pass} onClick={() => act({ action: "previews", runId: run.id })}>Render previews</Button>
          <span className="text-xs text-zinc-500">Cheap 720p previews of every shot, rendered from the shot sheet only.</span>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {run.versions.filter((v) => v.tier === "preview").map((v) => (
            <div key={v.id} className="rounded-lg border p-3 text-xs">
              <div className="mb-2 flex justify-between font-semibold"><span>{v.stack.label}</span><span className="text-zinc-400">{v.status}</span></div>
              {v.videoUrl ? <video src={v.videoUrl} controls className="w-full rounded" /> : <div className="aspect-video rounded bg-zinc-900" />}
              <div className="mt-2 flex gap-3 text-zinc-400"><span>{usd(v.usd)}</span><span>{secs(v.ms)}</span>{v.score != null && <span>score {v.score.toFixed(1)}</span>}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3" data-testid="final-step">
      <Button disabled={busy || !run.versions.some((v) => v.status === "done")} onClick={() => act({ action: "final", runId: run.id })}>Render final</Button>
      {run.final && (
        <div className="max-w-3xl space-y-2">
          <video src={run.final.videoUrl} controls className="w-full rounded" />
          <div className="text-sm">Final score <b>{run.final.score ?? "—"}</b>/10 · {usd(run.final.usd)} · {secs(run.final.ms)}</div>
        </div>
      )}
    </div>
  );
}
