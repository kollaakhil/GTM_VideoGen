"use client";

import { useState } from "react";
import { History } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RunSummary } from "./types";
import { hostName } from "./utils";

export function HistoryPanel({ runs, current, onOpen, onClose }: { runs: RunSummary[]; current?: string; onOpen: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [fmt, setFmt] = useState<"all" | "static" | "video">("all");
  const shown = runs.filter((r) => (fmt === "all" || r.format === fmt) && `${r.brandUrl} ${r.goal}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-[400px] flex-col border-l border-white/[0.06] bg-zinc-950/95 backdrop-blur-xl animate-in slide-in-from-right-8 duration-300">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        <History className="size-4 text-zinc-400" />
        <div className="text-sm font-semibold">History</div>
        <span className="text-xs text-zinc-500">{runs.length} runs</span>
        <button onClick={onClose} className="ml-auto text-zinc-500 hover:text-zinc-200" aria-label="Close history">
          ✕
        </button>
      </div>
      <div className="space-y-2 border-b border-white/[0.06] p-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search brand or goal…" className="h-8 w-full rounded-lg border border-white/10 bg-zinc-900 px-3 text-xs text-zinc-200 outline-none focus:border-indigo-400/50" />
        <div className="flex gap-1">
          {(["all", "static", "video"] as const).map((f) => (
            <button key={f} onClick={() => setFmt(f)} className={cn("rounded-md px-2 py-0.5 text-[11px] capitalize", fmt === f ? "bg-white/10 text-white" : "text-zinc-400 hover:text-zinc-200")}>
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
        {shown.map((r) => (
          <button key={r.id} onClick={() => onOpen(r.id)} className={cn("flex w-full gap-3 rounded-xl p-2 text-left transition hover:bg-white/[0.05]", r.id === current && "bg-white/[0.07] ring-1 ring-indigo-400/40")}>
            <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-md bg-white/[0.04]">
              {r.thumb?.type === "video" ? (
                <video src={r.thumb.url} muted preload="metadata" className="h-full w-full object-cover" />
              ) : r.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.thumb.url} alt="" className="h-full w-full object-cover" />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[13px] font-medium text-zinc-100">{hostName(r.brandUrl)}</span>
                <span className={cn("rounded px-1 text-[9px] uppercase tracking-wide", r.status === "error" ? "bg-red-500/15 text-red-300" : r.status === "working" ? "bg-indigo-500/15 text-indigo-300" : "bg-white/5 text-zinc-400")}>
                  {r.status === "idle" ? r.stage : r.status}
                </span>
              </div>
              <div className="line-clamp-2 text-[11px] leading-snug text-zinc-400">{r.goal}</div>
              <div className="mt-0.5 flex gap-2 text-[10px] text-zinc-500">
                <span>{new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                <span>{r.format}</span>
                <span>{r.creatives ? `${r.passed}/${r.creatives} passed` : "no creatives"}</span>
                <span>${r.costUsd.toFixed(2)}</span>
              </div>
            </div>
          </button>
        ))}
        {!shown.length && <p className="p-6 text-center text-xs text-zinc-500">No runs match.</p>}
      </div>
    </div>
  );
}
