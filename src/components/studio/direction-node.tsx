"use client";

import { useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { Wand2 } from "lucide-react";
import { storyboardProofPhoto } from "@/lib/quality-policy";
import type { NodeState, BeatEdit } from "./types";
import { useFlow } from "./context";
import { storyboardPhotos } from "./utils";
import { Shell, Skeleton, JobBar } from "./chrome";
import { ScriptLab } from "./script-lab";
import { VideoControls } from "./video-controls";

export function DirectionNode({ data }: NodeProps<Node<{ index: number }>>) {
  const { run, act, sending, form } = useFlow();
  const [openScript, setOpenScript] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, BeatEdit[]>>({});
  if (!run) return null;
  const d = run.directions[data.index];
  if (!d) {
    return (
      <Shell step={4} label={`Direction ${data.index + 1}`} icon={Wand2} state={run.status === "error" ? "error" : "working"} width={340}>
        {run.status === "error" ? <p className="text-xs text-red-300">Pitching failed. See the activity log.</p> : <Skeleton text="Pitching a distinct angle…" />}
      </Shell>
    );
  }
  const state: NodeState = run.stage === "generate" ? (run.status === "working" ? "working" : "active") : "done";
  const photos = storyboardPhotos(run, form);
  return (
    <Shell label={d.title} icon={Wand2} state={state} width={340} showCaption={false}>
      <div className="space-y-2.5">
        {d.format !== "video" && (
          <>
            <p className="text-sm font-medium text-zinc-200">“{d.hook}”</p>
            <p className="line-clamp-2 text-xs text-zinc-400" title={d.angle}>{d.angle}</p>
            <p className="line-clamp-3 text-xs text-zinc-400">{d.script}</p>
          </>
        )}
        {d.format === "video" && (
          <>
          <VideoControls d={d} />
          <ScriptLab
            key={d.hookLab?.id ?? d.id}
            d={d}
            open={openScript}
            setOpen={setOpenScript}
            edits={edits}
            setEdits={setEdits}
            busy={sending || run.status === "working"}
            needsPhoto={!photos.count && !storyboardProofPhoto(run.id, d)}
            lengthSec={form.plan.lengthSec}
            research={run.research}
            brief={run.brief}
            realOffer={run.offer}
            quotes={run.voc?.sourcedQuotes ?? []}
            refs={form.refs}
            onDraft={(proof, writer, judge) => act("draft_hooks", { runId: run.id, directionId: d.id, lengthSec: form.plan.lengthSec, writer, judge, proof })}
            onWrite={(hookId, writer, judge) => act("write_scripts", { runId: run.id, directionId: d.id, lengthSec: form.plan.lengthSec, writer, judge, hookId })}
            onApprove={(sc, lines) => act("approve_script", { runId: run.id, directionId: d.id, scriptId: sc.id, ...(lines ? { edit: { beats: lines } } : {}) }).then((ok) => {
              if (ok) setEdits((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== sc.id)));
            })}
            onStoryboard={(lengthSec) => act("storyboard", { runId: run.id, directionId: d.id, plan: { ...form.plan, lengthSec }, refs: photos.refs })}
          />
          </>
        )}
        {run.status === "working" && run.job?.directionId === d.id && <JobBar job={run.job} />}
        {d.format === "video" && (
          <details className="text-xs text-zinc-400">
            <summary className="cursor-pointer">Concept details</summary>
            <p className="mt-1">{d.angle}</p>
          </details>
        )}
      </div>
    </Shell>
  );
}
