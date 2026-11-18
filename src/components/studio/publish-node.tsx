"use client";

import { useState } from "react";
import Link from "next/link";
import { Inbox, Loader2, MessageSquare, Rocket } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Creative } from "@/lib/types";
import { useFlow } from "./context";
import { Shell } from "./chrome";

export function OrganicNode() {
  const { run } = useFlow();
  const [tab, setTab] = useState<"instagram" | "tiktok" | "linkedin" | "x" | "carousel">("instagram");
  const o = run?.organic;
  if (!o) return null;
  const copy = (t: string) => void navigator.clipboard?.writeText(t);
  const text =
    tab === "instagram" ? `${o.instagram.caption}\n\n${o.instagram.hashtags.join(" ")}`
    : tab === "tiktok" ? `HOOK: ${o.tiktok.hook}\n\n${o.tiktok.script}\n\nON SCREEN:\n${o.tiktok.onScreenText.join("\n")}`
    : tab === "linkedin" ? o.linkedin
    : tab === "x" ? o.xThread.map((t, i) => `${i + 1}/ ${t}`).join("\n\n")
    : o.carousel.map((s, i) => `Slide ${i + 1}: ${s.title}\n${s.body}`).join("\n\n");
  return (
    <Shell label="Organic content" icon={MessageSquare} state="done" width={380}>
      <div className="space-y-2.5">
        <div className="flex flex-wrap gap-1">
          {(["instagram", "tiktok", "linkedin", "x", "carousel"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cn("rounded-md px-2 py-0.5 text-[11px] capitalize", tab === t ? "bg-white/10 text-white" : "text-zinc-400 hover:text-zinc-200")}>
              {t === "x" ? "X thread" : t}
            </button>
          ))}
        </div>
        <pre className="nowheel max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-950/60 p-2.5 font-sans text-[12px] leading-relaxed text-zinc-300">{text}</pre>
        <Button size="sm" variant="outline" className="w-full" onClick={() => copy(text)}>
          Copy
        </Button>
      </div>
    </Shell>
  );
}

export function PublishNode() {
  const { run, byDir, act, sending } = useFlow();
  if (!run) return null;
  const list = run.directions.map((d) => byDir[d.id]).filter(Boolean);
  const passed = list.filter((c) => (c.gate ? c.gate.pass || (!!c.qaOverride && c.gate.reasons.every((r) => r.startsWith("QA "))) : c.qa?.pass)).length;
  const sent = list.filter((c) => c.status === "approved" || c.status === "paused" || c.status === "live").length;
  return (
    <Shell step={6} label="Gate · Live & learning" icon={Rocket} state={sent > 0 ? "done" : passed > 0 ? "active" : "idle"} width={300}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-white/[0.04] p-3">
            <div className="text-xl font-semibold tabular-nums text-white">
              {passed}
              <span className="text-sm text-zinc-500">/{list.length}</span>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Passed gate</div>
          </div>
          <div className="rounded-xl bg-white/[0.04] p-3">
            <div className="text-xl font-semibold tabular-nums text-white">{sent}</div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">In approval</div>
          </div>
        </div>
        <LiveResults list={list} />
        <p className="text-[12px] leading-relaxed text-zinc-400">
          {passed === 0
            ? "Nothing has passed the Creative Director Gate yet. Redo a creative, or edit the brief and generate again."
            : "Send passing creatives to Meta or Google from their cards. Ads are created paused and wait for you in the Inbox."}
        </p>
        <Link href="/inbox" className={cn(buttonVariants({ size: "sm", variant: "outline" }), "w-full")}>
          <Inbox /> Open Inbox
        </Link>
        {!run.organic && (
          <Button size="sm" variant="ghost" className="w-full text-zinc-300" disabled={sending || run.status === "working"} onClick={() => act("organic", { runId: run.id })}>
            <MessageSquare /> Write organic posts too
          </Button>
        )}
      </div>
    </Shell>
  );
}

function LiveResults({ list }: { list: Creative[] }) {
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const live = list.filter((c) => c.external?.meta || c.metrics);
  const failed = list.filter((c) => c.publishError);
  const t = live.reduce((a, c) => ({ spend: a.spend + (c.metrics?.spend ?? 0), revenue: a.revenue + (c.metrics?.revenue ?? 0), clicks: a.clicks + (c.metrics?.clicks ?? 0) }), { spend: 0, revenue: 0, clicks: 0 });
  if (!live.length && !failed.length) return null;
  const sync = async () => {
    setSyncing(true);
    const res = await fetch("/api/metrics/sync", { method: "POST" });
    const j = await res.json().catch(() => ({}));
    setNote(res.ok ? `Synced ${j.synced}/${j.total} ads${j.errors?.length ? ` · ${j.errors[0]}` : ""}` : j.error || "Sync failed");
    setSyncing(false);
  };
  return (
    <div className="space-y-2 rounded-xl bg-white/[0.04] p-3 text-[12px]">
      <div className="grid grid-cols-3 gap-1 tabular-nums text-white">
        <div><div className="font-semibold">${t.spend.toFixed(0)}</div><div className="text-[10px] uppercase text-zinc-500">Spend</div></div>
        <div><div className="font-semibold">{t.clicks}</div><div className="text-[10px] uppercase text-zinc-500">Clicks</div></div>
        <div><div className="font-semibold">{t.spend ? `${(t.revenue / t.spend).toFixed(1)}x` : "–"}</div><div className="text-[10px] uppercase text-zinc-500">ROAS</div></div>
      </div>
      {failed.map((c) => <p key={c.id} className="text-red-400">{c.title}: {c.publishError}</p>)}
      {live.length > 0 && (
        <Button size="sm" variant="outline" className="w-full" disabled={syncing} onClick={sync}>
          {syncing ? <Loader2 className="animate-spin" /> : <Rocket />} Sync results from Meta
        </Button>
      )}
      {note && <p className="text-zinc-400">{note}</p>}
      <p className="text-zinc-500">Results feed the learning loop for this brand&apos;s next batch.</p>
    </div>
  );
}
