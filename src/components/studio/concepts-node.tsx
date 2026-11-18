"use client";

import { useState } from "react";
import { Sparkles, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFlow } from "./context";
import { Shell, Skeleton, Label, Row } from "./chrome";

export function ConceptsNode() {
  const { run, act, sending } = useFlow();
  const [pick, setPick] = useState<string[] | null>(null);
  if (!run) return null;
  const list = run.concepts ?? [];
  const working = run.status === "working" && run.stage === "directions" && !list.length;
  const chosen = pick ?? list.filter((c) => c.selected).map((c) => c.id);
  const dirty = pick !== null && pick.join() !== list.filter((c) => c.selected).map((c) => c.id).join();
  const toggle = (id: string) => setPick(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id].slice(-5));
  return (
    <Shell step={3} label="Concept matrix" icon={LayoutGrid} state={!list.length ? "working" : run.directions.length ? "done" : "active"} width={420}>
      {!list.length ? (
        <Skeleton text={working ? "Mapping buyers × angles × formats…" : "Waiting…"} />
      ) : (
        <div className="nodrag nowheel space-y-2">
          <p className="text-[11px] text-zinc-500">Pick distinct concepts. Look-alikes are merged by ad platforms, so the gate requires ≥55% difference.</p>
          <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
            {list.map((c) => {
              const on = chosen.includes(c.id);
              return (
                <button key={c.id} onClick={() => toggle(c.id)} className={cn("w-full rounded-lg border px-2.5 py-2 text-left transition", on ? "border-indigo-400/60 bg-indigo-500/10" : "border-white/[0.06] bg-white/[0.02] hover:border-white/15")}>
                  <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-zinc-500">
                    <span className="truncate">{c.format} · {c.awareness}-aware</span>
                    {c.diversity !== undefined && <span className={cn(c.diversity >= 0.55 ? "text-emerald-400" : "text-amber-400")}>{Math.round(c.diversity * 100)}% distinct</span>}
                  </div>
                  <div className="mt-0.5 text-[13px] font-medium text-zinc-100">“{c.hook}”</div>
                  <div className="mt-0.5 line-clamp-2 text-[11px] text-zinc-400">{c.persona} · {c.angle} · {c.setting}</div>
                </button>
              );
            })}
          </div>
          {dirty && (
            <Button size="sm" disabled={sending || run.status === "working" || !chosen.length} onClick={() => act("pick_concepts", { runId: run.id, ids: chosen }).then(() => setPick(null))}>
              Use {chosen.length} selected
            </Button>
          )}
        </div>
      )}
    </Shell>
  );
}

export function StyleNode() {
  const { run } = useFlow();
  if (!run) return null;
  const d = run.styleDNA;
  const failed = run.status === "error" && run.stage === "research";
  return (
    <Shell label="Style DNA" icon={Sparkles} state={d ? "done" : failed ? "error" : "working"} width={380}>
      {!d ? (
        failed ? <p className="text-xs text-red-300">Couldn&apos;t read the reference brand.</p> : <Skeleton text="Reverse-engineering the reference brand's style…" />
      ) : (
        <div className="space-y-3">
          <div className="text-[13px] text-zinc-200">
            Borrowing <span className="font-semibold text-white">{d.brand}</span>&apos;s approach
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Row label="Tone">{d.tone}</Row>
            <Row label="Humor">{d.humor}</Row>
          </div>
          <Row label="Visuals">{d.visualLanguage}</Row>
          <Row label="Pacing">{d.pacing}</Row>
          <div className="space-y-1.5">
            <Label>Hook patterns</Label>
            <div className="flex flex-wrap gap-1">
              {d.hookPatterns.map((h) => (
                <span key={h} className="rounded-md bg-fuchsia-500/10 px-2 py-0.5 text-[11px] text-fuchsia-200">{h}</span>
              ))}
            </div>
          </div>
          <Row label="Never copy">
            <span className="text-zinc-400">{d.doNotCopy.join(", ")}</span>
          </Row>
        </div>
      )}
    </Shell>
  );
}
