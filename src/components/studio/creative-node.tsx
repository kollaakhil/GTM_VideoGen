"use client";

import type { Node, NodeProps } from "@xyflow/react";
import { ImageIcon, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreativeCard } from "@/components/creative-card";
import { useFlow } from "./context";
import { WORKING, PROGRESS_LABEL } from "./constants";
import { Handles, Shell, ProgressSteps } from "./chrome";

export function CreativeNode({ data }: NodeProps<Node<{ index: number }>>) {
  const { run, byDir, act, creativeAction, sending, form } = useFlow();
  if (!run) return null;
  const d = run.directions[data.index];
  if (!d) return null;
  const c = byDir[d.id];
  const p = run.progress[d.id];
  const busy = p && WORKING.includes(p);
  const redo = () => act("regenerate", { runId: run.id, directionId: d.id, refs: form.refs });

  if (!c || busy) {
    return (
      <Shell step={5} label={`Creative ${data.index + 1}`} icon={ImageIcon} state={p === "failed" ? "error" : "working"} width={300}>
        {p === "failed" ? (
          <div className="space-y-3">
            <p className="text-xs text-red-300">Generation failed. See the activity log.</p>
            <Button size="sm" variant="outline" disabled={sending || run.status === "working"} onClick={redo}>
              <RefreshCw /> Try again
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-white/[0.03]">
              <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-indigo-500/10 via-transparent to-fuchsia-500/10" />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-zinc-400">
                <Loader2 className="size-5 animate-spin text-indigo-300" />
                {PROGRESS_LABEL[p ?? "queued"]}
              </div>
            </div>
            <ProgressSteps p={p ?? "queued"} />
          </div>
        )}
      </Shell>
    );
  }
  return (
    <div className="relative w-[300px] animate-in fade-in zoom-in-95 duration-500">
      <div className="absolute -top-7 left-1 right-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
        <span>
          <span className="text-zinc-600">05</span> Creative {data.index + 1}
        </span>
        {c.gate ? (
          c.gate.pass ? <span className="flex items-center gap-1 text-emerald-400"><ShieldCheck className="size-3" /> Passed gate</span> : <span className="text-red-400" title={c.gate.reasons.join("\n")}>Gate: {c.gate.reasons.length} issue{c.gate.reasons.length === 1 ? "" : "s"}</span>
        ) : c.qa?.pass ? <span className="text-emerald-400">Passed QA</span> : <span className="text-red-400">Below QA bar</span>}
      </div>
      {c.gate && !c.gate.pass && (
        <ul className="mb-2 space-y-0.5 rounded-lg border border-red-500/20 bg-red-500/5 px-2.5 py-1.5 text-[11px] text-red-200">
          {c.gate.reasons.slice(0, 4).map((r) => <li key={r}>• {r}</li>)}
        </ul>
      )}
      <div className="nodrag nowheel">
        <CreativeCard
          creative={c}
          busy={sending || run.status === "working"}
          onAction={(a, ch, r) => creativeAction(c, a, ch, r)}
          onRegenerate={c.mediaType === "video" ? undefined : redo}
          onRepair={c.quality && c.quality.status !== "pass" && c.quality.storyboardKey === d.storyboardKey ? () => act("render_video", { runId: run.id, directionId: d.id, tier: c.quality!.tier }) : undefined}
        />
      </div>
      <Handles />
    </div>
  );
}
