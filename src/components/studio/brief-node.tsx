"use client";

import { useState } from "react";
import { Lightbulb, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Brief } from "@/lib/types";
import type { NodeState } from "./types";
import { useFlow } from "./context";
import { Shell, Skeleton, Label, Row } from "./chrome";

export function BriefNode() {
  const { run, act, sending, editing, setEditing } = useFlow();
  const [draft, setDraft] = useState<Brief | null>(null);
  if (!run) return null;
  const b = run.brief;
  const idle = run.status !== "working";
  const canEdit = !!b && idle && (run.stage === "directions" || run.stage === "generate");
  const failed = run.status === "error" && run.stage === "brief";
  const state: NodeState = !b ? (failed ? "error" : "working") : run.stage === "directions" ? "active" : run.status === "working" && run.stage === "brief" ? "working" : "done";

  const startEdit = () => {
    setDraft(b);
    setEditing(true);
  };
  const save = async () => {
    if (!draft) return;
    if (await act("edit_brief", { runId: run.id, brief: { ...draft, mandatories: draft.mandatories.filter((m) => m.trim()) } })) setEditing(false);
  };

  return (
    <Shell
      step={3}
      label="Creative brief"
      icon={Lightbulb}
      state={state}
      width={400}
      action={
        canEdit && !editing && (
          <button onClick={startEdit} className="rounded-md p-1 text-zinc-400 hover:bg-white/5 hover:text-zinc-100" aria-label="Edit brief" title="Edit brief">
            <Pencil className="size-3.5" />
          </button>
        )
      }
    >
      {!b ? (
        failed ? <p className="text-xs text-red-300">Writing the brief failed. See the activity log.</p> : <Skeleton text="Distilling research into a one-page brief…" />
      ) : editing && draft ? (
        <div className="space-y-2.5">
          {(["objective", "audience", "insight", "offer", "kpi"] as const).map((k) => (
            <div key={k} className="space-y-1">
              <Label>{k}</Label>
              <Textarea value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} rows={2} className="min-h-0 resize-none bg-zinc-950/60 text-[13px]" />
            </div>
          ))}
          <div className="space-y-1">
            <Label>Mandatories (one per line)</Label>
            <Textarea
              value={draft.mandatories.join("\n")}
              onChange={(e) => setDraft({ ...draft, mandatories: e.target.value.split("\n") })}
              rows={3}
              className="resize-none bg-zinc-950/60 text-[13px]"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <Button size="sm" disabled={sending} onClick={save}>
              {sending && <Loader2 className="animate-spin" />} Save brief
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Row label="Objective">{b.objective}</Row>
          <Row label="Insight">
            <span className="italic text-zinc-100">“{b.insight}”</span>
          </Row>
          <div className="grid grid-cols-2 gap-3">
            <Row label="Offer">{b.offer}</Row>
            <Row label="KPI">{b.kpi}</Row>
          </div>
          <Row label="Audience">{b.audience}</Row>
          <div className="space-y-1.5">
            <Label>Mandatories</Label>
            <div className="flex flex-wrap gap-1">
              {b.mandatories.map((m) => (
                <span key={m} className="rounded-md border border-white/10 px-2 py-0.5 text-[11px] text-zinc-300">{m}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
