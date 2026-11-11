"use client";

import { Check, ShieldCheck, Shuffle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { kpis, usd } from "@/lib/format";
import type { Creative } from "@/lib/types";

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
}: {
  creative: Creative;
  onAction?: (a: "approve" | "reject" | "request_publish", channel?: "meta" | "google") => void;
}) {
  const k = kpis(c.metrics);
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="relative aspect-[4/5] bg-muted">
        {c.mediaType === "video" ? (
          <video src={c.mediaUrl} controls className="size-full object-cover" />
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
        {c.qa && c.qa.notes.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
            {c.qa.notes.slice(0, 3).map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        {onAction && (c.status === "draft" || c.status === "approved") && (
          <div className="flex gap-1.5 pt-1">
            {c.status === "draft" && (
              <Button size="xs" variant="outline" onClick={() => onAction("reject")}>
                <X /> Reject
              </Button>
            )}
            <Button size="xs" variant="outline" disabled={!c.qa?.pass} onClick={() => onAction("request_publish", "meta")}>
              <Check /> Meta
            </Button>
            <Button size="xs" variant="outline" disabled={!c.qa?.pass} onClick={() => onAction("request_publish", "google")}>
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
