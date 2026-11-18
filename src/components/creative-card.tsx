"use client";

import { useRef, useState } from "react";
import { Check, RefreshCw, ShieldCheck, Shuffle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { kpis, usd } from "@/lib/format";
import type { Creative } from "@/lib/types";
import { strictVideoBlock } from "@/lib/quality-policy";

const STATUS: Record<Creative["status"], string> = {
  draft: "bg-zinc-500/20 text-zinc-300",
  approved: "bg-sky-500/20 text-sky-300",
  live: "bg-emerald-500/20 text-emerald-300",
  paused: "bg-amber-500/20 text-amber-300",
  rejected: "bg-red-500/20 text-red-300",
};

export function CreativeCard({
  creative: c,
  onAction,
  onRegenerate,
  onRepair,
  busy,
}: {
  creative: Creative;
  onAction?: (a: "approve" | "reject" | "request_publish" | "override_qa", channel?: "meta" | "google", reason?: string) => void;
  onRegenerate?: () => void;
  onRepair?: () => void;
  busy?: boolean;
}) {
  const k = kpis(c.metrics);
  const [rejecting, setRejecting] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  const report = c.quality;
  const releaseBlock = strictVideoBlock(c) || (c.mediaType === "video" && !c.gate?.pass ? "The Creative Director Gate has not passed." : null);
  const seek = (at: number) => {
    if (player.current) {
      player.current.currentTime = at;
      player.current.scrollIntoView({ block: "nearest" });
    }
  };
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="relative aspect-[4/5] bg-muted">
        {c.mediaType === "video" ? (
          <video ref={player} src={c.mediaUrl} controls playsInline preload="metadata" className="size-full object-contain" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.mediaUrl} alt={c.hook} className="size-full object-cover" />
        )}
        <span className={cn("absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize", STATUS[c.status])}>{c.status}</span>
        {c.qa && (
          <span
            className={cn(
              "absolute right-2 top-2 flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
              c.qa.pass ? "bg-emerald-500 text-white" : "bg-red-500 text-white",
            )}
          >
            <ShieldCheck className="size-3" /> QA {c.qa.score}/10
          </span>
        )}
      </div>
      <div className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="truncate text-sm font-medium">{c.title}</div>
          {c.diversity !== null && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground" title="Distinctness vs. other creatives in the set">
              <Shuffle className="size-3" /> {Math.round(c.diversity * 100)}%
            </span>
          )}
        </div>
        <p className="line-clamp-2 text-xs text-muted-foreground" title={c.angle}>{c.angle}</p>
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline">{c.format}</Badge>
          {c.channel && <Badge variant="outline">{c.channel === "meta" ? "Meta" : "Google"}</Badge>}
        </div>
        {k && c.metrics && (
          <div className="grid grid-cols-4 gap-1 rounded-md bg-muted/50 p-2 text-center text-[11px]">
            <Stat label="Spend" value={usd(c.metrics.spend)} />
            <Stat label="CTR" value={`${k.ctr.toFixed(2)}%`} />
            <Stat label="CPA" value={usd(k.cpa)} />
            <Stat label="ROAS" value={`${k.roas.toFixed(1)}x`} />
          </div>
        )}
        {!!c.variants?.length && (
          <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
            Cuts:
            <a href={c.mediaUrl} target="_blank" rel="noreferrer" className="rounded border border-white/10 px-1.5 py-0.5 hover:text-foreground">9:16</a>
            {c.variants.map((v) => (
              <a key={v.aspect} href={v.url} target="_blank" rel="noreferrer" className="rounded border border-white/10 px-1.5 py-0.5 hover:text-foreground">{v.aspect}</a>
            ))}
          </div>
        )}
        {c.copy && (
          <details className="group rounded-md border border-white/[0.06] px-2 py-1.5 text-[11px]">
            <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">Ad copy</summary>
            <div className="mt-1.5 space-y-1.5">
              <div><span className="text-muted-foreground">Meta · </span>{c.copy.metaPrimaryText}</div>
              <div><span className="text-muted-foreground">Headline · </span><span className="font-medium">{c.copy.metaHeadline}</span> <span className="text-muted-foreground">[{c.copy.metaCta.replace(/_/g, " ").toLowerCase()}]</span></div>
              <div><span className="text-muted-foreground">Google · </span>{c.copy.googleHeadlines.join(" | ")}</div>
              <div className="text-muted-foreground">{c.copy.googleDescriptions.join(" ")}</div>
            </div>
          </details>
        )}
        {c.qa && c.qa.notes.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
            {c.qa.notes.slice(0, 3).map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        {onAction && rejecting && c.status === "draft" && (
          <div className="space-y-1 rounded-lg border border-red-400/20 bg-red-500/[0.04] p-2">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Why? The engine learns from this</div>
            <div className="flex flex-wrap gap-1">
              {["Off-brand", "Wrong product", "Weak hook", "Visual glitch", "Wrong claim", "Not our audience", "No reason"].map((r) => (
                <button
                  key={r}
                  disabled={busy}
                  onClick={() => {
                    setRejecting(false);
                    onAction("reject", undefined, r === "No reason" ? undefined : r);
                  }}
                  className="rounded-md border border-white/10 px-1.5 py-0.5 text-[11px] text-zinc-300 hover:border-red-400/40 hover:text-red-200"
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}
        {report && (
          <details className="space-y-2 rounded-md border px-2 py-1.5 text-xs">
            <summary className="cursor-pointer">
              {report.tier === "draft" ? "Draft" : "HD"} QA · {report.status === "review" ? "Needs review" : report.status === "pass" ? "Pass" : "Fail"} · {report.score}/10
            </summary>
            <div className="nowheel max-h-72 space-y-2 overflow-y-auto break-words">
              {report.findings.map((f, i) => (
                <div key={i} className="rounded border p-1.5">
                  <button type="button" className="font-medium text-amber-300 underline" onClick={() => seek(f.at)}>{f.at.toFixed(2)}s · {f.kind}{f.aspect ? ` · ${f.aspect}` : ""}</button>
                  <p>Expected: {f.expected}</p>
                  <p>Observed: {f.observed}</p>
                </div>
              ))}
              {report.shots.map((s, i) => (
                <details key={s.id} className="space-y-1 rounded border p-1.5">
                  <summary className="cursor-pointer">Shot {i + 1} · {s.qa?.score ?? "Ungraded"}{s.qa && "/10"} · {s.qa?.match ?? "review"}</summary>
                  <p>Action: {s.visual}</p>
                  {s.vo && <p>Hear: {s.vo}</p>}
                  {s.onScreen && <p>Read: {s.onScreen}</p>}
                  {s.keyframe && <a className="block underline" href={s.keyframe} target="_blank" rel="noreferrer">Storyboard reference</a>}
                  {s.qa?.frames?.map((f) => (
                    <div key={f.at}><button type="button" className="underline" onClick={() => seek(f.at)}>{f.at.toFixed(2)}s</button> · {f.match}{f.note ? ` · ${f.note}` : ""}</div>
                  ))}
                </details>
              ))}
            </div>
            {onRepair && <Button size="xs" variant="outline" disabled={busy} onClick={onRepair}><RefreshCw /> Repair and recheck</Button>}
          </details>
        )}
        {onAction && (c.status === "draft" || c.status === "approved") && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {c.status === "draft" && (
              <Button size="xs" variant="outline" disabled={busy} onClick={() => setRejecting((v) => !v)}>
                <X /> Reject
              </Button>
            )}
            {onRegenerate && (
              <Button size="xs" variant="outline" disabled={busy} onClick={onRegenerate}>
                <RefreshCw /> Redo
              </Button>
            )}
            <Button size="xs" variant="outline" disabled={busy || !c.qa?.pass || !!releaseBlock} title={releaseBlock ?? "Send to Inbox for approval"} onClick={() => onAction("request_publish", "meta")}>
              <Check /> Meta
            </Button>
            <Button size="xs" variant="outline" disabled={busy || !c.qa?.pass || !!releaseBlock} title={releaseBlock ?? "Send to Inbox for approval"} onClick={() => onAction("request_publish", "google")}>
              <Check /> Google
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
