"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFlow } from "./context";
import { Shell, Skeleton, Label, Row } from "./chrome";

export function ResearchNode() {
  const { run } = useFlow();
  const [more, setMore] = useState(false);
  if (!run) return null;
  const r = run.research;
  const working = run.status === "working" && run.stage === "research";
  const failed = run.status === "error" && run.stage === "research";
  return (
    <Shell step={2} label="Research" icon={Search} state={r ? (run.stage === "brief" ? "active" : "done") : failed ? "error" : "working"} width={380}>
      {!r ? (
        failed ? <p className="text-xs text-red-300">Research failed. See the activity log.</p> : <Skeleton text={working ? "Reading the site and mapping the market…" : "Waiting…"} />
      ) : (
        <div className="space-y-3">
          <p className={cn("text-[13px] leading-relaxed text-zinc-300", !more && "line-clamp-4")}>{r.summary}</p>
          <div className="grid grid-cols-2 gap-3">
            <Row label="Audience"><span className={cn(!more && "line-clamp-4")}>{r.audience}</span></Row>
            <Row label="Tone"><span className={cn(!more && "line-clamp-4")}>{r.tone}</span></Row>
          </div>
          {more && (
            <Row label="Value props">
              <ul className="list-disc space-y-0.5 pl-4">
                {r.valueProps.map((v) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
            </Row>
          )}
          <div className="space-y-1.5">
            <Label>Angles</Label>
            <div className="flex flex-wrap gap-1">
              {(more ? r.angles : r.angles.slice(0, 4)).map((a) => (
                <span key={a} title={a} className="max-w-full truncate rounded-md bg-white/[0.06] px-2 py-0.5 text-[11px] text-zinc-300">{a.split(/[:.(]/)[0]}</span>
              ))}
              {!more && r.angles.length > 4 && <span className="px-1 py-0.5 text-[11px] text-zinc-500">+{r.angles.length - 4}</span>}
            </div>
          </div>
          {run.voc && (
            <div className="space-y-1.5">
              <Label>Customer language{run.voc.sources.length ? ` · ${run.voc.sources.length} source${run.voc.sources.length === 1 ? "" : "s"}` : ""}</Label>
              <div className="flex flex-wrap gap-1">
                {(more ? run.voc.phrases : run.voc.phrases.slice(0, 3)).map((ph) => (
                  <span key={ph} className="max-w-full truncate rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-200">“{ph}”</span>
                ))}
              </div>
              {more && <Row label="Objections"><span>{run.voc.objections.join("; ")}</span></Row>}
            </div>
          )}
          {!!run.inspirations?.length && (
            <div className="space-y-1.5">
              <Label>Inspiration breakdown · structure only</Label>
              {run.inspirations.map((b) => (
                <div key={b.id} className="flex gap-2 rounded-md bg-fuchsia-500/[0.06] p-1.5 text-[11px] text-zinc-300">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {b.thumb && <img src={b.thumb} alt="" className="h-12 w-7 shrink-0 rounded object-cover" />}
                  <div className="min-w-0 space-y-0.5">
                    <div className="truncate text-zinc-200">{b.format || b.kind} · {b.source.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}</div>
                    {b.kind === "video" && <div className="text-zinc-400">{b.duration}s · {b.shotCount} shots · {b.avgShotSec}s avg{b.firstCutSec ? ` · first cut ${b.firstCutSec}s` : ""}{b.wordsPerSec ? ` · ${b.wordsPerSec} words/s` : ""}</div>}
                    {b.hook && <div className={cn(!more && "line-clamp-2")}>Hook: {b.hook}</div>}
                    {more && b.shots.length > 0 && <div className="text-zinc-400">{b.shots.map((s) => [s.framing, s.lens, s.motion].filter(Boolean).join(", ")).filter(Boolean).join(" → ")}</div>}
                    {more && <div className="text-[10px] text-zinc-500">cuts: {b.via.cuts} · transcript: {b.via.transcript} · OCR: {b.via.ocr} · vision: {b.via.vision}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
          <button onClick={() => setMore(!more)} className="text-[11px] text-indigo-300 hover:text-indigo-200">{more ? "Show less" : "Show more"}</button>
        </div>
      )}
    </Shell>
  );
}
