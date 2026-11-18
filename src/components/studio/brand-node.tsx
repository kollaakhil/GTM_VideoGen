"use client";

import { ChevronDown, Film, Globe, ImageIcon, Loader2, Sparkles, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Modality } from "./types";
import { useFlow } from "./context";
import { hostName, urlOk } from "./utils";
import { Shell, Label } from "./chrome";

export function BrandNode() {
  const { run, form, start, sending, models } = useFlow();
  if (run) {
    const host = hostName(run.brandUrl);
    return (
      <Shell step={1} label="Brand & goal" icon={Globe} state="done" width={360}>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/30 to-fuchsia-500/30 text-sm font-semibold uppercase text-white">
              {host[0]}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-zinc-100">{host}</div>
              <div className="text-[11px] text-zinc-500">{run.format === "video" ? "Video ads" : "Static ads"}</div>
            </div>
          </div>
          <p className="text-[13px] leading-snug text-zinc-300">{run.goal}</p>
          {run.referenceUrl && <div className="text-[11px] text-fuchsia-300/90">Inspired by {run.referenceUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</div>}
        </div>
      </Shell>
    );
  }
  const pick = (m: Modality) => models.filter((x) => x.modality === m);
  const missing = !urlOk(form.brandUrl)
    ? "Enter your website, e.g. allbirds.com"
    : form.goal.trim().length < 3
      ? "Add a goal to start"
      : form.referenceUrl.trim() && !urlOk(form.referenceUrl)
        ? "Check the Inspired by link"
        : "";
  const canStart = !sending && !missing;
  return (
    <Shell step={1} label="Brand & goal" icon={Globe} state="active" width={380}>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>Website</Label>
          <Input value={form.brandUrl} onChange={(e) => form.set({ brandUrl: e.target.value })} placeholder="https://yourbrand.com" className="h-9 bg-zinc-950/60" />
        </div>
        {form.kits.length > 0 && (
          <div className="space-y-1.5">
            <Label>Brand kit</Label>
            <select
              defaultValue=""
              onChange={(e) => {
                const k = form.kits.find((x) => x.id === e.target.value);
                if (k) form.set({ brandUrl: k.url, offer: k.offer ?? "", refs: k.photos ?? [] });
              }}
              className="h-9 w-full rounded-md border border-white/10 bg-zinc-950/60 px-2 text-sm text-zinc-200"
            >
              <option value="">Load a saved brand…</option>
              {form.kits.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                  {k.photos?.length ? ` · ${k.photos.length} photo${k.photos.length > 1 ? "s" : ""}` : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label>Offer &amp; facts (optional)</Label>
          <Textarea
            value={form.offer}
            onChange={(e) => form.set({ offer: e.target.value })}
            placeholder="e.g. 20% off first order with code HELLO20, free US shipping over $50"
            rows={2}
            className="resize-none bg-zinc-950/60"
          />
          <p className="text-[10px] leading-snug text-zinc-500">Used word-for-word, so ads never invent prices or terms.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Inspired by (optional)</Label>
          <Input
            value={form.referenceUrl}
            onChange={(e) => form.set({ referenceUrl: e.target.value })}
            placeholder="https://liquiddeath.com"
            className="h-9 bg-zinc-950/60"
          />
          <p className="text-[10px] leading-snug text-zinc-500">Borrow another brand&apos;s creative style, never its logo or claims.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Goal</Label>
          <Textarea
            value={form.goal}
            onChange={(e) => form.set({ goal: e.target.value })}
            placeholder="e.g. Drive first purchases from US millennials at < $40 CPA"
            rows={3}
            className="resize-none bg-zinc-950/60"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-white/10 bg-zinc-950/60 p-0.5">
            {(["static", "video"] as const).map((f) => (
              <button
                key={f}
                onClick={() => form.set({ format: f })}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs capitalize transition-colors",
                  form.format === f ? "bg-white/10 font-medium text-white" : "text-zinc-400 hover:text-zinc-200",
                )}
              >
                {f === "static" ? <ImageIcon className="size-3" /> : <Film className="size-3" />} {f}
              </button>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-200">
            <Upload className="size-3" /> Product photos
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              hidden
              onChange={(e) => {
                [...(e.target.files ?? [])].slice(0, 4).forEach((f) => {
                  if (f.size > 5_000_000) return;
                  const r = new FileReader();
                  r.onload = () => form.set({ refs: [...form.refs, String(r.result)].slice(0, 4) });
                  r.readAsDataURL(f);
                });
              }}
            />
          </label>
        </div>
        {form.refs.length > 0 && (
          <div className="flex gap-1.5">
            {form.refs.map((src, i) => (
              <div key={i} className="group relative size-12 overflow-hidden rounded-lg border border-white/10">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="size-full object-cover" />
                <button
                  onClick={() => form.set({ refs: form.refs.filter((_, j) => j !== i) })}
                  className="absolute right-0.5 top-0.5 hidden rounded-full bg-black/70 p-0.5 group-hover:block"
                  aria-label="Remove photo"
                >
                  <X className="size-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <details className="group text-xs text-zinc-400">
          <summary className="flex cursor-pointer select-none list-none items-center gap-1 hover:text-zinc-200">
            <ChevronDown className="size-3 transition-transform group-open:rotate-180" /> Models
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(["text", "vision", "image", "video"] as const).map((k) => (
              <label key={k} className="space-y-1">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">{k}</span>
                <select
                  className="w-full rounded-md border border-white/10 bg-zinc-950 px-2 py-1 text-xs text-zinc-200"
                  value={form.sel[k]}
                  onChange={(e) => form.set({ sel: { ...form.sel, [k]: e.target.value } })}
                >
                  {pick(k).map((m) => (
                    <option key={m.id + m.label} value={m.id} disabled={!m.ready}>
                      {m.label}
                      {m.ready ? "" : " (key needed)"}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </details>
        <Button className="w-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white hover:opacity-90" disabled={!canStart} onClick={start}>
          {sending ? <Loader2 className="animate-spin" /> : <Sparkles />} Start research
        </Button>
        {missing && !sending && <p className="-mt-1 text-center text-[11px] text-amber-300/90">{missing}</p>}
      </div>
    </Shell>
  );
}
