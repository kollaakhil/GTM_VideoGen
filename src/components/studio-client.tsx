"use client";

import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AlertTriangle, Clapperboard, ArrowRight, Square, Check, ChevronDown, Film, Globe, History, ImageIcon, Inbox, Lightbulb, Loader2, MessageSquare, Pencil, Plus, RefreshCw, Rocket, Search, Sparkles, Upload, Wand2, X, LayoutGrid, ShieldCheck } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CreativeCard } from "@/components/creative-card";
import { cn } from "@/lib/utils";
import type { ModelOption } from "@/lib/models";
import type { AdScript, Brand, Brief, Creative, CreativeProgress, Direction, Shot, StudioRun, VideoCategory, VideoPlan } from "@/lib/types";
import { CATEGORIES, estimateCost, LENGTHS, shotCount } from "@/lib/video-categories";

type Model = ModelOption & { ready: boolean };
type Modality = "text" | "vision" | "image" | "video";
type RunSummary = Pick<StudioRun, "id" | "brandUrl" | "goal" | "stage" | "status" | "costUsd" | "createdAt" | "format" | "updatedAt"> & {
  thumb: { url: string; type: "image" | "video" } | null;
  creatives: number;
  passed: number;
};

const hostName = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

function HistoryPanel({ runs, current, onOpen, onClose }: { runs: RunSummary[]; current?: string; onOpen: (id: string) => void; onClose: () => void }) {
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
type NodeState = "done" | "active" | "working" | "error" | "idle";
type CreativeAction = "approve" | "reject" | "request_publish" | "override_qa";

interface Ctx {
  run: StudioRun | null;
  byDir: Record<string, Creative>;
  sending: boolean;
  models: Model[];
  form: {
    brandUrl: string;
    referenceUrl: string;
    offer: string;
    saveKit: boolean;
    kits: Brand[];
    goal: string;
    format: "static" | "video";
    sel: Record<Modality, string>;
    refs: string[];
    plan: VideoPlan;
    set: (patch: Partial<Omit<Ctx["form"], "set">>) => void;
  };
  start: () => void;
  act: (action: string, extra?: Record<string, unknown>) => Promise<boolean>;
  creativeAction: (c: Creative, a: CreativeAction, ch?: "meta" | "google", reason?: string) => void;
  editing: boolean;
  setEditing: (v: boolean) => void;
  pricing: Pricing;
}

type Pricing = { credits: number | null; prices: Record<string, { draft: number | null; final: number | null }> };
const FlowCtx = createContext<Ctx | null>(null);
const useFlow = () => useContext(FlowCtx)!;

const DEFAULT_PLAN: VideoPlan = { category: "product_demo", lengthSec: 10, draftModel: "fal-ai/bytedance/seedance/v1/lite/image-to-video", finalModel: "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video", voice: "Rachel", music: true, budgetUsd: 3 };
const money = (n: number | null | undefined) => (n == null ? "?" : `$${n.toFixed(2)}`);
const VOICE_OPTIONS = ["Rachel", "Aria", "Sarah", "Charlotte", "Jessica", "Lily", "Roger", "George", "Liam", "Will", "Eric", "Brian", "Daniel"];
const SB_SHIFT = 430;

const SPINE = { brand: 0, research: 440, brief: 900 };
const DIR_Y = 780;
const CR_Y = 1150;
const PUB_Y = 1980;
const DIR_X = [560, 930, 1300];
const WORKING: CreativeProgress[] = ["queued", "rendering", "qa", "fixing"];
const PROGRESS_LABEL: Record<CreativeProgress, string> = {
  queued: "Queued",
  rendering: "Rendering",
  qa: "Vision QA",
  fixing: "Auto-fixing from QA notes",
  done: "Done",
  failed: "Failed",
};

const HANDLE = "!size-2 !border-0 !bg-zinc-600 !opacity-0";
function Handles() {
  return (
    <>
      <Handle id="l" type="target" position={Position.Left} isConnectable={false} className={HANDLE} />
      <Handle id="t" type="target" position={Position.Top} isConnectable={false} className={HANDLE} />
      <Handle id="r" type="source" position={Position.Right} isConnectable={false} className={HANDLE} />
      <Handle id="b" type="source" position={Position.Bottom} isConnectable={false} className={HANDLE} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Node chrome                                                         */
/* ------------------------------------------------------------------ */

function Shell({
  step,
  label,
  icon: Icon,
  state,
  width,
  children,
  action,
}: {
  step?: number;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  state: NodeState;
  width: number;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div style={{ width }} className="relative animate-in fade-in slide-in-from-left-6 duration-500">
      <div className="absolute -top-7 left-1 right-1 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
          {step !== undefined && <span className="text-zinc-600">{String(step).padStart(2, "0")}</span>}
          {label}
        </div>
        <StateChip state={state} />
      </div>
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border bg-zinc-900/95 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)] transition-[border-color,box-shadow] duration-300",
          state === "active" && "border-indigo-400/70 shadow-[0_0_0_4px_rgba(99,102,241,0.12),0_20px_60px_-20px_rgba(0,0,0,0.8)]",
          state === "working" && "border-indigo-400/40",
          state === "done" && "border-white/[0.08]",
          state === "idle" && "border-white/[0.08]",
          state === "error" && "border-red-500/50",
        )}
      >
        {state === "working" && <div className="absolute inset-x-0 top-0 h-px animate-pulse bg-gradient-to-r from-transparent via-indigo-400 to-transparent" />}
        <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-4 py-3">
          <div
            className={cn(
              "flex size-7 items-center justify-center rounded-lg",
              state === "done" ? "bg-emerald-500/15 text-emerald-300" : state === "error" ? "bg-red-500/15 text-red-300" : "bg-indigo-500/15 text-indigo-300",
            )}
          >
            <Icon className="size-3.5" />
          </div>
          <div className="text-[13px] font-semibold tracking-tight text-zinc-100">{label}</div>
          <div className="ml-auto flex items-center gap-1">{action}</div>
        </div>
        <div className="nodrag nowheel cursor-default select-text px-4 py-3.5">{children}</div>
      </div>
      <Handles />
    </div>
  );
}

function StateChip({ state }: { state: NodeState }) {
  if (state === "done") return <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-400"><Check className="size-3" />Done</span>;
  if (state === "active") return <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-medium text-indigo-300">Your turn</span>;
  if (state === "working") return <span className="flex items-center gap-1 text-[10px] font-medium text-indigo-300"><Loader2 className="size-3 animate-spin" />Working</span>;
  if (state === "error") return <span className="flex items-center gap-1 text-[10px] font-medium text-red-400"><AlertTriangle className="size-3" />Failed</span>;
  return null;
}

function Skeleton({ text }: { text: string }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 text-xs text-indigo-200/80">
        <Loader2 className="size-3.5 animate-spin" /> {text}
      </div>
      {[92, 78, 85, 60].map((w, i) => (
        <div key={i} className="h-2.5 animate-pulse rounded-full bg-white/[0.06]" style={{ width: `${w}%`, animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">{children}</div>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <Label>{label}</Label>
      <div className="text-[13px] leading-snug text-zinc-200">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Nodes                                                               */
/* ------------------------------------------------------------------ */

function BrandNode() {
  const { run, form, start, sending, models } = useFlow();
  if (run) {
    let host = run.brandUrl;
    try {
      host = new URL(run.brandUrl).hostname.replace(/^www\./, "");
    } catch {}
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
  const urlOk = (u: string) => /^https?:\/\/[^/\s]+\.[^/\s]+/.test(u);
  const canStart = !sending && form.goal.trim().length >= 3 && urlOk(form.brandUrl) && (!form.referenceUrl.trim() || urlOk(form.referenceUrl.trim()));
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
      </div>
    </Shell>
  );
}

function ResearchNode() {
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
          <button onClick={() => setMore(!more)} className="text-[11px] text-indigo-300 hover:text-indigo-200">{more ? "Show less" : "Show more"}</button>
        </div>
      )}
    </Shell>
  );
}

function ConceptsNode() {
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

function StyleNode() {
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

function BriefNode() {
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

function VideoPlanNode() {
  const { run, form, models, act, sending, pricing } = useFlow();
  if (!run) return null;
  const p = form.plan;
  const set = (patch: Partial<VideoPlan>) => form.set({ plan: { ...p, ...patch } });
  const shots = shotCount(p.lengthSec, p.category);
  const video = models.filter((m) => m.modality === "video" && (m.provider === "openrouter" || m.id in pricing.prices));
  const sel = "w-full rounded-md border border-white/10 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200";
  const has = run.directions.some((d) => d.shots?.length);
  return (
    <Shell label="Video plan" icon={Clapperboard} state={has ? "done" : "active"} width={360}>
      <div className="space-y-2.5">
        <label className="block space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Category</span>
          <select className={sel} value={p.category} onChange={(e) => set({ category: e.target.value as VideoCategory })}>
            {Object.entries(CATEGORIES).map(([k, c]) => (
              <option key={k} value={k}>{c.label}</option>
            ))}
          </select>
          <span className="block text-[11px] leading-snug text-zinc-500">{CATEGORIES[p.category].beats.join(" → ")}</span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Length</span>
            <select className={sel} value={p.lengthSec} onChange={(e) => set({ lengthSec: Number(e.target.value) })}>
              {LENGTHS.map((l) => (
                <option key={l} value={l}>{l}s · {shotCount(l, p.category)} shots</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Voice</span>
            <select className={sel} value={p.voice} onChange={(e) => set({ voice: e.target.value })}>
              {VOICE_OPTIONS.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Draft model</span>
            <select className={sel} value={p.draftModel} onChange={(e) => set({ draftModel: e.target.value })}>
              {video.map((m) => (
                <option key={m.id} value={m.id}>{m.label}{pricing.prices[m.id]?.draft != null ? ` · $${pricing.prices[m.id].draft!.toFixed(2)}/s` : ""}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Final model</span>
            <select className={sel} value={p.finalModel} onChange={(e) => set({ finalModel: e.target.value })}>
              {video.map((m) => (
                <option key={m.id} value={m.id}>{m.label}{pricing.prices[m.id]?.final != null ? ` · $${pricing.prices[m.id].final!.toFixed(2)}/s` : ""}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Budget cap / video</span>
            <input type="number" min={1} max={500} step={1} className={sel} value={p.budgetUsd} onChange={(e) => set({ budgetUsd: Math.max(1, Number(e.target.value) || 1) })} />
          </label>
          <label className="flex items-end gap-2 pb-1.5 text-xs text-zinc-300">
            <input type="checkbox" checked={p.music} onChange={(e) => set({ music: e.target.checked })} /> Music bed
          </label>
        </div>
        {(() => {
          const draft = estimateCost("video", { perSec: pricing.prices[p.draftModel]?.draft, lengthSec: p.lengthSec, shots, music: p.music });
          const final = estimateCost("video", { perSec: pricing.prices[p.finalModel]?.final, lengthSec: p.lengthSec, shots, music: p.music });
          const low = pricing.credits != null && pricing.credits < draft * 1.2;
          return (
            <div className="space-y-1 rounded-lg bg-white/[0.03] p-2 text-[11px] leading-snug text-zinc-400">
              <div>Storyboards ≈ {money(estimateCost("storyboard", { lengthSec: p.lengthSec, shots: shots * run.directions.length }))}</div>
              <div>
                Per video: draft ≈ <span className={cn(draft > p.budgetUsd && "text-amber-300")}>{money(draft)}</span>, final ≈ <span className={cn(final > p.budgetUsd && "text-amber-300")}>{money(final)}</span>
              </div>
              <div className={cn(low ? "text-red-300" : "text-zinc-500")}>OpenRouter balance: {money(pricing.credits)}{low ? " · too low for a draft, add credits" : ""}</div>
              {(draft > p.budgetUsd || final > p.budgetUsd) && <div className="text-amber-300">Over your cap: shorten the video, pick a cheaper model or raise the cap.</div>}
            </div>
          );
        })()}
        <Button size="sm" className="w-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white hover:opacity-90" disabled={sending || run.status === "working"} onClick={() => act("storyboard", { runId: run.id, plan: p, refs: form.refs })}>
          <Clapperboard /> {has ? "Rebuild storyboards" : "Build storyboards"}
        </Button>
      </div>
    </Shell>
  );
}

function ShotThumb({ d, s }: { d: Direction; s: Shot }) {
  const { run, act, sending, form } = useFlow();
  const score = s.clipQa?.score ?? s.keyframeQa?.score;
  const notes = (s.clipQa ?? s.keyframeQa)?.notes ?? [];
  // eslint-disable-next-line @next/next/no-img-element
  const img = s.keyframe ? <img src={s.keyframe} alt={s.beat} className="aspect-[9/16] w-full rounded-md object-cover ring-1 ring-white/10" /> : <div className="aspect-[9/16] w-full animate-pulse rounded-md bg-white/5" />;
  return (
    <div className="group relative w-[58px] shrink-0" title={`${s.beat.toUpperCase()}: ${s.visual}\nVO: ${s.vo}${notes.length ? `\nQA: ${notes.join(" ")}` : ""}`}>
      {s.clip ? (
        <a href={s.clip} target="_blank" rel="noreferrer">
          {img}
        </a>
      ) : (
        img
      )}
      {score != null && <span className={cn("absolute left-1 top-1 rounded px-1 text-[9px] font-semibold text-black", score >= 8 ? "bg-emerald-400" : "bg-amber-300")}>{score}</span>}
      {s.clip && <Film className="absolute bottom-5 left-1 size-3 text-white drop-shadow" />}
      <button
        aria-label="Redraw shot"
        disabled={sending || run?.status === "working"}
        onClick={() => act("redo_shot", { runId: run!.id, directionId: d.id, shotId: s.id, refs: form.refs })}
        className="absolute right-1 top-1 hidden rounded bg-black/70 p-0.5 text-white group-hover:block disabled:opacity-40"
      >
        <RefreshCw className="size-3" />
      </button>
      <div className="mt-0.5 truncate text-[9px] uppercase tracking-wide text-zinc-500">{s.beat}</div>
    </div>
  );
}

function JobBar({ job }: { job: NonNullable<StudioRun["job"]> }) {
  const pct = job.total ? Math.round((job.done / job.total) * 100) : 5;
  return (
    <div className="space-y-1">
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-fuchsia-400 transition-all duration-700" style={{ width: `${Math.max(5, pct)}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-zinc-400">
        <span className="truncate pr-2">{job.label}</span>
        <span className="tabular-nums">{job.total ? `${job.done}/${job.total}` : "…"}</span>
      </div>
    </div>
  );
}

const scoreTone = (n: number) => (n >= 8 ? "bg-emerald-500/15 text-emerald-300" : n >= 6 ? "bg-amber-500/15 text-amber-300" : "bg-red-500/15 text-red-300");

const WRITERS: Record<string, string> = { "openai/gpt-6.1-sol": "Sol", "anthropic/claude-opus-5.5": "Opus 5.5", "google/gemini-4-carbon": "Carbon" };
const JUDGE_MODEL = "google/gemini-4-carbon";
const savedWriter = () => {
  const w = typeof window === "undefined" ? null : localStorage.getItem("gtm.writer");
  return w && w in WRITERS ? w : "anthropic/claude-opus-5.5";
};

function ScriptLab({ d, open, setOpen, edits, setEdits, busy, onWrite, onApprove }: {
  d: Direction;
  open: string | null;
  setOpen: (id: string | null) => void;
  edits: Record<string, string[]>;
  setEdits: (e: Record<string, string[]>) => void;
  busy: boolean;
  onWrite: (writer: string) => void;
  onApprove: (sc: AdScript, lines?: string[]) => void;
}) {
  const ap = d.approvedScript;
  const [writer, setWriter] = useState(savedWriter);
  const pickWriter = (w: string) => {
    setWriter(w);
    localStorage.setItem("gtm.writer", w);
  };
  const write = () => onWrite(writer);
  return (
    <div className="nodrag space-y-1.5 rounded-lg border border-white/5 bg-white/[0.02] p-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Script Lab ·{" "}
          <select className="rounded bg-zinc-900 text-zinc-300" value={writer} onChange={(e) => pickWriter(e.target.value)} disabled={busy} aria-label="Script writer">
            {Object.entries(WRITERS).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>{" "}
          writes, {WRITERS[writer === JUDGE_MODEL ? "anthropic/claude-opus-5.5" : JUDGE_MODEL]} grades
        </span>
        <button className="text-[10px] text-indigo-300 hover:underline disabled:opacity-40" disabled={busy} onClick={write}>
          {d.scripts?.length ? "Rewrite all" : ""}
        </button>
      </div>
      {ap && (
        <div className="flex items-center gap-1.5 text-[11px] text-emerald-300">
          <Check className="size-3" /> Approved: {ap.framework}
          {ap.score && <span className={`rounded px-1 ${scoreTone(ap.score.overall)}`}>{ap.score.overall}/10</span>}
        </div>
      )}
      {!d.scripts?.length ? (
        <Button size="sm" variant="secondary" className="w-full" disabled={busy} onClick={write}>
          <Pencil /> Write scripts
        </Button>
      ) : (
        d.scripts.map((sc) => {
          const isOpen = open === sc.id;
          const lines = edits[sc.id];
          const sco = sc.score;
          return (
            <div key={sc.id} className={`rounded-md border p-1.5 ${ap?.id === sc.id ? "border-emerald-500/40" : "border-white/5"}`}>
              <button className="flex w-full items-center gap-1.5 text-left" onClick={() => setOpen(isOpen ? null : sc.id)}>
                {sco && <span className={`rounded px-1 text-[10px] font-semibold ${scoreTone(sc.checks?.length ? Math.min(7, sco.overall) : sco.overall)}`}>{sco.overall}/10</span>}
                <span className="truncate text-[11px] font-medium text-zinc-200">{sc.framework}</span>
                {sco && <span className="ml-auto shrink-0 text-[10px] text-zinc-500" title="Simulated buyers who keep watching after the hook">{sco.panel.stopRate}/10 stop</span>}
                <ChevronDown className={`size-3 shrink-0 text-zinc-500 transition ${isOpen ? "rotate-180" : ""}`} />
              </button>
              <p className="mt-1 text-[11px] italic text-zinc-300">“{sc.hook.spoken}”</p>
              {isOpen && (
                <div className="mt-1.5 space-y-1.5">
                  {sc.beats.map((b, i) => (
                    <div key={i} className="space-y-0.5">
                      <div className="text-[10px] text-zinc-500">{i + 1}. {b.seconds}s · {b.visual.slice(0, 90)}{b.onScreen ? ` · on screen: “${b.onScreen}”` : ""}</div>
                      <textarea
                        aria-label={`Beat ${i + 1} voiceover`}
                        className="nowheel w-full resize-none rounded border border-white/10 bg-zinc-950 px-1.5 py-1 text-[11px] text-zinc-200"
                        rows={2}
                        value={lines?.[i] ?? b.vo}
                        onChange={(e) => {
                          const next = [...(lines ?? sc.beats.map((x) => x.vo))];
                          next[i] = e.target.value;
                          setEdits({ ...edits, [sc.id]: next });
                        }}
                      />
                    </div>
                  ))}
                  <div className="text-[10px] text-zinc-400">CTA: {sc.cta}</div>
                  {sco && (
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(sco.scores).map(([k, v]) => (
                        <span key={k} className={`rounded px-1 text-[9px] ${scoreTone(v)}`}>{k} {v}</span>
                      ))}
                    </div>
                  )}
                  {[...(sco?.unsupported ?? []).map((u) => `Unsupported: ${u}`), ...(sc.checks ?? []), ...(sco?.notes ?? [])].slice(0, 5).map((n, i) => (
                    <p key={i} className="text-[10px] text-amber-200/80">• {n}</p>
                  ))}
                  {sco?.panel.quotes.map((q, i) => <p key={i} className="text-[10px] text-zinc-500">Buyer: “{q}”</p>)}
                  <Button size="sm" className="w-full" disabled={busy} onClick={() => onApprove(sc, lines)}>
                    <Check /> {ap?.id === sc.id ? "Re-approve with edits" : "Approve this script"}
                  </Button>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function DirectionNode({ data }: NodeProps<Node<{ index: number }>>) {
  const { run, act, sending, form, pricing, models } = useFlow();
  const [vm, setVm] = useState<{ draft?: string; final?: string }>({});
  const [openScript, setOpenScript] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string[]>>({});
  if (!run) return null;
  const vplan = run.videoPlan ?? form.plan;
  const pickModel = { draft: vm.draft ?? vplan.draftModel, final: vm.final ?? vplan.finalModel };
  const videoModels = models.filter((m) => m.modality === "video" && (m.provider === "openrouter" || m.id in pricing.prices));
  const d = run.directions[data.index];
  if (!d) {
    return (
      <Shell step={4} label={`Direction ${data.index + 1}`} icon={Wand2} state={run.status === "error" ? "error" : "working"} width={340}>
        {run.status === "error" ? <p className="text-xs text-red-300">Pitching failed. See the activity log.</p> : <Skeleton text="Pitching a distinct angle…" />}
      </Shell>
    );
  }
  const state: NodeState = run.stage === "generate" ? (run.status === "working" ? "working" : "active") : "done";
  return (
    <Shell step={4} label={`Direction ${data.index + 1}`} icon={Wand2} state={state} width={340}>
      <div className="space-y-2.5">
        <div className="text-[15px] font-semibold leading-snug tracking-tight text-white">“{d.hook}”</div>
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] font-medium text-zinc-300">{d.title}</span>
        </div>
        <p className="line-clamp-2 text-[11px] text-zinc-500" title={d.angle}>{d.angle}</p>
        <p className="line-clamp-3 text-[12px] leading-relaxed text-zinc-400">{d.script}</p>
        {d.format === "video" && (
          <ScriptLab
            d={d}
            open={openScript}
            setOpen={setOpenScript}
            edits={edits}
            setEdits={setEdits}
            busy={sending || run.status === "working"}
            onWrite={(writer) => act("write_scripts", { runId: run.id, directionId: d.id, lengthSec: vplan.lengthSec, writer })}
            onApprove={(sc, lines) => act("approve_script", { runId: run.id, directionId: d.id, scriptId: sc.id, ...(lines ? { edit: { beats: sc.beats.map((b, i) => ({ vo: lines[i] ?? b.vo, onScreen: b.onScreen })) } } : {}) })}
          />
        )}
        {run.status === "working" && run.job?.directionId === d.id && <JobBar job={run.job} />}
        {d.shots?.length ? (
          <div className="space-y-2 border-t border-white/5 pt-2.5">
            <div className="nowheel flex gap-1.5 overflow-x-auto pb-1">
              {d.shots.map((s) => (
                <ShotThumb key={s.id} d={d} s={s} />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {(["draft", "final"] as const).map((tier) => (
                <select
                  key={tier}
                  aria-label={tier === "draft" ? "Draft video model" : "HD video model"}
                  className="nodrag w-full truncate rounded-md border border-white/10 bg-zinc-950 px-1.5 py-1 text-[10px] text-zinc-300"
                  value={pickModel[tier]}
                  onChange={(e) => setVm({ ...vm, [tier]: e.target.value })}
                >
                  {videoModels.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}{pricing.prices[m.id]?.[tier] != null ? ` · $${pricing.prices[m.id][tier]!.toFixed(3)}/s` : ""}</option>
                  ))}
                </select>
              ))}
            </div>
            <div className="flex gap-1.5">
              {(["draft", "final"] as const).map((tier) => (
                <Button
                  key={tier}
                  size="sm"
                  variant={tier === "final" ? "default" : "outline"}
                  className={cn("flex-1", tier === "final" && "bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white hover:opacity-90")}
                  disabled={sending || run.status === "working" || d.shots!.some((s) => !s.keyframe)}
                  onClick={() => act("render_video", { runId: run.id, directionId: d.id, tier, refs: form.refs, draftModel: pickModel.draft, finalModel: pickModel.final })}
                >
                  <Film /> {tier === "draft" ? "480p draft" : "Upgrade to HD"} ~$
                  {estimateCost("video", { perSec: pricing.prices[pickModel[tier]]?.[tier], lengthSec: d.shots!.reduce((t, s) => t + s.seconds, 0), shots: d.shots!.length, music: vplan.music }).toFixed(2)}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Shell>
  );
}

function CreativeNode({ data }: NodeProps<Node<{ index: number }>>) {
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
          onRegenerate={redo}
        />
      </div>
      <Handles />
    </div>
  );
}

function ProgressSteps({ p }: { p: CreativeProgress }) {
  const steps: CreativeProgress[] = ["rendering", "qa", "fixing", "done"];
  const idx = steps.indexOf(p);
  return (
    <div className="flex items-center gap-1">
      {["Render", "QA", "Fix", "Done"].map((s, i) => (
        <div key={s} className="flex-1 space-y-1">
          <div className={cn("h-1 rounded-full", i < idx ? "bg-emerald-400/70" : i === idx ? "animate-pulse bg-indigo-400" : "bg-white/10")} />
          <div className="text-center text-[9px] uppercase tracking-wider text-zinc-500">{s}</div>
        </div>
      ))}
    </div>
  );
}

function OrganicNode() {
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

function PublishNode() {
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

function GhostNode({ data }: NodeProps<Node<{ label: string; step: number; hint: string; icon: keyof typeof GHOST_ICONS; order: number }>>) {
  const Icon = GHOST_ICONS[data.icon];
  return (
    <div className="relative w-[280px] opacity-60 animate-in fade-in duration-700">
      <div className="absolute -top-7 left-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
        {String(data.step).padStart(2, "0")} {data.label}
      </div>
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-white/15 bg-zinc-900/40 px-4 py-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-white/[0.04] text-zinc-500">
          <Icon className="size-4" />
        </div>
        <div className="text-[12px] leading-snug text-zinc-500">{data.hint}</div>
      </div>
      <Handles />
    </div>
  );
}

const GHOST_ICONS = { research: Search, brief: Lightbulb, dir: Wand2, creative: ImageIcon, publish: Rocket };
const GHOSTS = [
  { key: "research", step: 2, label: "Research", hint: "Reads your site and maps audience, tone and angles", x: SPINE.research, y: 160, order: 1 },
  { key: "brief", step: 3, label: "Creative brief", hint: "A 20-second brief you can edit and approve", x: SPINE.brief, y: 160, order: 2 },
  { key: "dir", step: 4, label: "Directions", hint: "Three distinct hooks and visual worlds", x: 960, y: DIR_Y, order: 3 },
  { key: "creative", step: 5, label: "Creatives", hint: "Images or video, scored by the Vision QA gate", x: 960, y: CR_Y, order: 4 },
  { key: "publish", step: 6, label: "Gate · Live & learning", hint: "Gate-passed ads go out paused after your approval; results feed the next batch", x: 960, y: PUB_Y, order: 5 },
] as const;

const noop = () => {};
const nodeTypes = { concepts: ConceptsNode, ghost: GhostNode, style: StyleNode, organic: OrganicNode, videoplan: VideoPlanNode, brand: BrandNode, research: ResearchNode, brief: BriefNode, direction: DirectionNode, creative: CreativeNode, publish: PublishNode };

/* ------------------------------------------------------------------ */
/* Graph                                                               */
/* ------------------------------------------------------------------ */

function useGraph(run: StudioRun | null, byDir: Record<string, Creative>, dirH = 0) {
  return useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const working = run?.status === "working";
    let order = 0;
    const edge = (source: string, target: string, down: boolean, opts: { active?: boolean; tone?: "pass" | "fail" } = {}): Edge => ({
      id: `${source}->${target}`,
      source,
      target,
      sourceHandle: down ? "b" : "r",
      targetHandle: down ? "t" : "l",
      animated: !!opts.active,
      style: {
        stroke: opts.active ? "#818cf8" : opts.tone === "pass" ? "#34d399" : opts.tone === "fail" ? "#f87171" : "#52525b",
        strokeWidth: opts.active ? 2 : 1.5,
        strokeDasharray: opts.tone === "fail" ? "5 5" : undefined,
      },
    });
    const withGhosts = () => {
      let sources = nodes.filter((n) => (n.data as { order?: number }).order === order).map((n) => n.id);
      for (const g of GHOSTS) {
        if (g.order <= order) continue;
        const id = `ghost-${g.key}`;
        nodes.push({ id, type: "ghost", position: { x: g.x, y: g.y }, data: { label: g.label, step: g.step, hint: g.hint, icon: g.key, order: g.order } });
        sources.forEach((src) => edges.push({ ...edge(src, id, g.order >= 3), animated: false, style: { stroke: "#3f3f46", strokeWidth: 1.5, strokeDasharray: "4 6" } }));
        sources = [id];
      }
      return { nodes, edges };
    };

    nodes.push({ id: "brand", type: "brand", position: { x: SPINE.brand, y: 0 }, data: { order: 0 } });
    if (!run) return withGhosts();

    nodes.push({ id: "research", type: "research", position: { x: SPINE.research, y: 0 }, data: { order: 1 } });
    edges.push(edge("brand", "research", false, { active: working && run.stage === "research" }));
    order = 1;
    if (run.referenceUrl) {
      nodes.push({ id: "style", type: "style", position: { x: SPINE.research, y: -900 }, data: {} });
      edges.push(edge("brand", "style", false, { active: working && run.stage === "research" }));
    }

    if (run.brief || (run.stage === "brief" && run.status !== "idle")) {
      nodes.push({ id: "brief", type: "brief", position: { x: SPINE.brief, y: 0 }, data: { order: 2 } });
      edges.push(edge("research", "brief", false, { active: working && run.stage === "brief" }));
      if (run.referenceUrl) edges.push(edge("style", "brief", false, { active: working && run.stage === "brief" }));
      order = 2;
    }

    const hasConcepts = !!run.concepts?.length;
    if (hasConcepts) {
      nodes.push({ id: "concepts", type: "concepts", position: { x: SPINE.brief + 460, y: 0 }, data: { order: 3 } });
      edges.push(edge("brief", "concepts", false, { active: working && run.stage === "directions" && !run.directions.length }));
    }
    if (run.directions.length > 0 || (run.stage === "directions" && run.status !== "idle" && hasConcepts)) {
      const n = Math.max(1, Math.min(3, run.directions.length || 3));
      Array.from({ length: n }, (_, i) => i).forEach((i) => {
        nodes.push({ id: `dir-${i}`, type: "direction", position: { x: DIR_X[i], y: DIR_Y }, data: { index: i, order: 3 } });
        edges.push(edge(hasConcepts ? "concepts" : "brief", `dir-${i}`, true, { active: working && run.stage === "directions" }));
      });
      order = 3;
    }

    const sb = Math.max(run.directions.some((d) => d.shots?.length) ? SB_SHIFT : 0, dirH ? DIR_Y + dirH + 90 - CR_Y : 0);
    if (run.format === "video" && run.directions.length > 0) {
      nodes.push({ id: "videoplan", type: "videoplan", position: { x: 140, y: DIR_Y }, data: {} });
      edges.push(edge("brief", "videoplan", true, {}));
    }
    let anyCreative = false;
    run.directions.forEach((d, i) => {
      const c = byDir[d.id];
      const p = run.progress[d.id];
      if (!c && !p) return;
      anyCreative = true;
      nodes.push({ id: `cr-${i}`, type: "creative", position: { x: DIR_X[i] + 20, y: CR_Y + sb }, data: { index: i, order: 4 } });
      edges.push(edge(`dir-${i}`, `cr-${i}`, true, { active: !!p && WORKING.includes(p) }));
    });
    if (anyCreative) order = 4;

    if (run.stage === "qa" || run.stage === "publish") {
      nodes.push({ id: "publish", type: "publish", position: { x: 950, y: PUB_Y + sb }, data: { order: 5 } });
      if (run.organic) {
        nodes.push({ id: "organic", type: "organic", position: { x: 1340, y: PUB_Y + sb }, data: {} });
        edges.push(edge("publish", "organic", false, {}));
      }
      run.directions.forEach((d, i) => {
        const c = byDir[d.id];
        if (c) edges.push(edge(`cr-${i}`, "publish", true, { tone: c.qa?.pass ? "pass" : "fail" }));
      });
      order = 5;
    }
    return withGhosts();
  }, [run, byDir, dirH]);
}

/* ------------------------------------------------------------------ */
/* Dock: always-visible next step                                      */
/* ------------------------------------------------------------------ */

function Dock({ elapsed, notice }: { elapsed: number; notice: string | null }) {
  const { run, act, sending, form, setEditing } = useFlow();
  const router = useRouter();
  if (!run) return null;

  const lastError = run.status === "error" ? [...run.events].reverse().find((e) => e.role === "error")?.text : null;
  const btn = (label: string, onClick: () => void, primary = false, icon?: React.ReactNode) => (
    <Button
      key={label}
      size="sm"
      variant={primary ? "default" : "ghost"}
      disabled={sending}
      onClick={onClick}
      className={primary ? "bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white hover:opacity-90" : "text-zinc-300"}
    >
      {icon}
      {label}
      {primary && <ArrowRight />}
    </Button>
  );

  let text: React.ReactNode = null;
  let buttons: React.ReactNode[] = [];
  if (run.status === "working") {
    const total = run.directions.length;
    const done = run.directions.filter((d) => run.progress[d.id] === "done" || run.progress[d.id] === "failed").length;
    text = (
      <span className="flex items-center gap-2">
        <Loader2 className="size-4 animate-spin text-indigo-300" />
        {run.job?.label ?? run.activity}
        {run.stage === "generate" && total > 0 && <span className="text-zinc-500">{done}/{total}</span>}
        {run.job && (
          <span className="flex w-44 items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <span className="block h-full rounded-full bg-gradient-to-r from-indigo-400 to-fuchsia-400 transition-all duration-700" style={{ width: `${Math.max(5, run.job.total ? Math.round((run.job.done / run.job.total) * 100) : 5)}%` }} />
            </span>
            <span className="tabular-nums text-zinc-500">{run.job.total ? `${run.job.done}/${run.job.total}` : ""}</span>
          </span>
        )}
        <span className="tabular-nums text-zinc-500">{elapsed}s</span>
      </span>
    );
    buttons = [btn("Stop", () => act("cancel", { runId: run.id }), false, <Square className="fill-current" />)];
  } else {
    switch (run.stage) {
      case "research":
        text = "Research didn't finish.";
        buttons = [
          btn("Start over", () => router.push("/studio"), false),
          btn("Retry research", () => act("research", { brandUrl: run.brandUrl, goal: run.goal, format: run.format, referenceUrl: run.referenceUrl ?? "", offer: run.offer ?? undefined, models: run.models }), true),
        ];
        break;
      case "brief":
        text = "Research is ready. Review it, then write the brief.";
        buttons = [btn("Write the brief", () => act("brief", { runId: run.id }), true)];
        break;
      case "directions":
        if (run.concepts?.length) {
          text = "Pick the most distinct concepts on the Concept matrix, then turn them into directions.";
          buttons = [
            btn("Rebuild concepts", () => act("concepts", { runId: run.id, format: run.format }), false, <RefreshCw />),
            btn("Turn into directions", () => act("directions", { runId: run.id, format: run.format }), true),
          ];
          break;
        }
        text = "Approve the brief to build a concept matrix: buyers × angles × formats, checked for diversity.";
        buttons = [
          btn("Edit", () => setEditing(true), false, <Pencil />),
          btn("Rewrite", () => act("brief", { runId: run.id }), false, <RefreshCw />),
          btn("Skip to directions", () => act("directions", { runId: run.id, format: run.format }), false),
          btn("Approve brief", () => act("concepts", { runId: run.id, format: run.format }), true),
        ];
        break;
      case "generate":
        if (run.format === "video") {
          const hasSb = run.directions.some((d) => d.shots?.length);
          const approved = run.directions.filter((d) => d.approvedScript).length;
          if (!approved) {
            const written = run.directions.some((d) => d.scripts?.length);
            text = written ? "Open a script on each direction, edit any line, and approve one. Storyboards, voice and video only use approved scripts." : "Script first: Sol writes 5 scripts per direction and Carbon grades them before anything is drawn or rendered.";
            buttons = [btn(written ? "Rewrite scripts" : "Write scripts", () => act("write_scripts", { runId: run.id, lengthSec: form.plan.lengthSec, writer: savedWriter() }), !written, <Pencil />)];
            break;
          }
          text = hasSb ? "Review the storyboards. Redraw weak shots, then render a draft or final video on each direction." : "Pick a category and length on the Video plan card, then build storyboards before any video spend.";
          buttons = [
            btn("Re-pitch", () => act("directions", { runId: run.id, format: run.format }), false, <RefreshCw />),
            btn(hasSb ? "Rebuild storyboards" : "Build storyboards", () => act("storyboard", { runId: run.id, plan: form.plan, refs: form.refs }), !hasSb),
          ];
          break;
        }
        text = "Happy with the directions? Generate images and run Vision QA.";
        buttons = [
          btn("Re-pitch", () => act("directions", { runId: run.id, format: run.format }), false, <RefreshCw />),
          btn("Generate creatives", () => act("generate", { runId: run.id, refs: form.refs }), true),
        ];
        break;
      default:
        text = "Send passing creatives to the Inbox, or redo the ones below the QA bar.";
        buttons = [
          ...(run.format === "video" ? [] : [btn("Regenerate all", () => act("generate", { runId: run.id, refs: form.refs }), false, <RefreshCw />)]),
          btn("New run", () => router.push("/studio"), false, <Plus />),
        ];
    }
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center px-6">
      <div className="pointer-events-auto flex max-w-3xl items-center gap-4 rounded-2xl border border-white/10 bg-zinc-900/90 py-2 pl-4 pr-2 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.9)] backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4 duration-300">
        <div className="min-w-0 text-[13px] text-zinc-200">
          {notice ? <span className="text-emerald-300">{notice}</span> : lastError ? (
            <span className="flex items-start gap-2 text-red-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span className="line-clamp-4">{lastError}</span>
            </span>
          ) : (
            text
          )}
        </div>
        {buttons.length > 0 && <div className="flex shrink-0 items-center gap-1">{buttons}</div>}
        <div className="shrink-0 border-l border-white/10 pl-3 pr-1 text-[11px] tabular-nums text-zinc-500">${run.costUsd.toFixed(2)}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Studio                                                              */
/* ------------------------------------------------------------------ */

function Canvas({ elapsed, notice }: { elapsed: number; notice: string | null }) {
  const { run, byDir } = useFlow();
  const [dirHs, setDirHs] = useState<Record<string, number>>({});
  const dirH = Math.round(Math.max(0, ...Object.values(dirHs)) / 40) * 40;
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const next: Record<string, number> = {};
    for (const c of changes) if (c.type === "dimensions" && c.dimensions && c.id.startsWith("dir-")) next[c.id] = c.dimensions.height;
    if (Object.keys(next).length) setDirHs((h) => ({ ...h, ...next }));
  }, []);
  const { nodes, edges } = useGraph(run, byDir, dirH);
  const flow = useReactFlow();
  const seen = useRef<string>("");

  useEffect(() => {
    const ids = nodes.filter((n) => n.type !== "ghost").map((n) => n.id);
    const key = ids.join(",");
    if (key === seen.current) return;
    const prev = new Set(seen.current ? seen.current.split(",") : []);
    seen.current = key;
    const fresh = ids.filter((id) => !prev.has(id));
    const focus = prev.size > 0 && fresh.length ? fresh : ids.length === 1 ? ["brand"] : ids.slice(-3);
    // Not cleared on re-render: polling recreates `nodes`, which would otherwise cancel the pending fit.
    const fit = () => flow.fitView({ nodes: focus.map((id) => ({ id })), padding: 0.15, maxZoom: 1, minZoom: 0.45, duration: prev.size ? 700 : 0 });
    setTimeout(fit, 250);
  }, [nodes, flow]);

  return (
    <div className="relative min-h-0 flex-1 bg-zinc-950">
      <ReactFlow
        nodes={nodes}
        onNodesChange={onNodesChange}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        onNodeClick={noop}
        panOnScroll
        minZoom={0.2}
        maxZoom={1.5}
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
        className="!bg-transparent"
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="#27272a" />
        <Controls showInteractive={false} position="bottom-left" className="!overflow-hidden !rounded-xl !border !border-white/10 !shadow-none" />
      </ReactFlow>
      <Dock elapsed={elapsed} notice={notice} />
    </div>
  );
}

function StudioInner({ models, defaults }: { models: Model[]; defaults: Record<Modality, string> }) {
  const router = useRouter();
  const params = useSearchParams();
  const runId = params.get("run");

  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [run, setRun] = useState<StudioRun | null>(null);
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [form, setForm] = useState({ brandUrl: "https://", referenceUrl: "", offer: "", saveKit: true, kits: [] as Brand[], goal: "", format: "static" as "static" | "video", sel: defaults, refs: [] as string[], plan: DEFAULT_PLAN });

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  };

  const fetchJSON = useCallback(async (url: string, init?: RequestInit) => {
    const res = await fetch(url, init);
    if (res.status === 401) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      throw new Error("Not signed in");
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
    return json;
  }, []);

  const [pricing, setPricing] = useState<Pricing>({ credits: null, prices: {} });
  const loadRuns = useCallback(() => fetchJSON("/api/studio").then((j) => setRuns(j.runs)).catch(() => {}), [fetchJSON]);
  const loadRun = useCallback(
    (id: string) =>
      fetchJSON(`/api/studio?runId=${encodeURIComponent(id)}`)
        .then((j) => {
          setRun(j.run);
          setCreatives(j.creatives);
        })
        .catch((e) => flash((e as Error).message)),
    [fetchJSON],
  );

  const loadKits = useCallback(
    () => fetchJSON("/api/brands").then((j) => setForm((f) => ({ ...f, kits: j.brands }))).catch(() => {}),
    [fetchJSON],
  );
  const loadPricing = useCallback(() => fetchJSON("/api/video-pricing").then((j) => setPricing({ credits: j.credits ?? null, prices: j.prices ?? {} })).catch(() => {}), [fetchJSON]);
  const runStatus = run?.status;
  useEffect(() => {
    if (runStatus !== "working") void loadPricing();
  }, [loadPricing, runStatus]);

  useEffect(() => {
    loadRuns();
    loadKits();
  }, [loadRuns, loadKits]);

  useEffect(() => {
    if (runId) loadRun(runId);
    else {
      setRun(null);
      setCreatives([]);
    }
    setEditing(false);
  }, [runId, loadRun]);

  const status = run?.status;
  const id = run?.id;
  useEffect(() => {
    if (status !== "working" || !id) return;
    const since = Date.now();
    setElapsed(0);
    const poll = setInterval(() => loadRun(id), 1500);
    const tick = setInterval(() => setElapsed(Math.round((Date.now() - since) / 1000)), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      loadRuns();
    };
  }, [status, id, loadRun, loadRuns]);

  const act = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      setSending(true);
      try {
        const j = await fetchJSON("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
        setRun(j.run);
        if (action === "research") router.replace(`/studio?run=${j.run.id}`);
        return true;
      } catch (e) {
        flash((e as Error).message);
        return false;
      } finally {
        setSending(false);
      }
    },
    [fetchJSON, router],
  );

  const start = () => {
    if (form.saveKit && form.brandUrl.trim().length > 10)
      void fetch("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: form.brandUrl.trim(), offer: form.offer.trim() || undefined, photos: form.refs.length ? form.refs : undefined }),
      }).then(loadKits);
    return startRun();
  };
  const startRun = () => act("research", { offer: form.offer.trim() || undefined, brandUrl: form.brandUrl.trim(), referenceUrl: form.referenceUrl.trim(), goal: form.goal.trim(), format: form.format, models: form.sel });

  const creativeAction = async (c: Creative, a: CreativeAction, ch?: "meta" | "google", reason?: string) => {
    try {
      const j = await fetchJSON("/api/creatives", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id, action: a, channel: ch, reason }) });
      setCreatives((xs) => xs.map((x) => (x.id === c.id ? j.creative : x)));
      if (a === "request_publish") flash(`“${c.title}” is waiting in the Inbox. It will be created as a paused ad.`);
    } catch (e) {
      flash((e as Error).message);
    }
  };

  const byDir = useMemo(() => {
    const m: Record<string, Creative> = {};
    for (const c of creatives) if (c.directionId) m[c.directionId] = c;
    return m;
  }, [creatives]);

  const ctx: Ctx = {
    run,
    byDir,
    sending,
    models,
    form: { ...form, set: (patch) => setForm((f) => ({ ...f, ...patch })) },
    pricing,
    start,
    act,
    creativeAction,
    editing,
    setEditing,
  };

  return (
    <FlowCtx.Provider value={ctx}>
      <div className="flex h-screen flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] px-5">
          <div className="text-sm font-semibold tracking-tight">Studio</div>
          <div className="h-4 w-px bg-white/10" />
          <div className="min-w-0 truncate text-[13px] text-zinc-400">{run ? run.goal : "New run"}</div>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-8" onClick={() => setShowHistory((v) => !v)}>
              <History /> History ({runs.length})
            </Button>
            {run && (
              <Button size="sm" variant="outline" className="h-8" onClick={() => setShowLog(!showLog)}>
                <MessageSquare /> Activity
              </Button>
            )}
            <Button size="sm" className="h-8" onClick={() => router.push("/studio")}>
              <Plus /> New run
            </Button>
          </div>
        </header>
        <div className="relative flex min-h-0 flex-1">
          <Canvas elapsed={elapsed} notice={notice} />
          {showHistory && (
            <HistoryPanel
              runs={runs}
              current={run?.id}
              onClose={() => setShowHistory(false)}
              onOpen={(id) => {
                setShowHistory(false);
                router.push(`/studio?run=${id}`);
              }}
            />
          )}
          {showLog && run && (
            <aside className="absolute bottom-24 right-4 top-4 z-20 flex w-80 flex-col rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3 text-[13px] font-semibold">
                Activity
                <button onClick={() => setShowLog(false)} className="text-zinc-500 hover:text-zinc-200" aria-label="Close activity">
                  <X className="size-4" />
                </button>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {run.events.map((e, i) => (
                  <div
                    key={i}
                    className={cn(
                      "whitespace-pre-wrap rounded-xl px-3 py-2 text-[12px] leading-relaxed",
                      e.role === "user" && "ml-6 bg-indigo-500/15 text-indigo-100",
                      e.role === "agent" && "mr-6 bg-white/[0.05] text-zinc-300",
                      e.role === "error" && "border border-red-500/30 bg-red-500/10 text-red-200",
                    )}
                  >
                    {e.text}
                    <div className="mt-1 text-[10px] text-zinc-500">{new Date(e.at).toLocaleTimeString()}</div>
                  </div>
                ))}
              </div>
            </aside>
          )}
        </div>
      </div>
    </FlowCtx.Provider>
  );
}

export function StudioClient(props: { models: Model[]; defaults: Record<Modality, string> }) {
  return (
    <Suspense>
      <ReactFlowProvider>
        <StudioInner {...props} />
      </ReactFlowProvider>
    </Suspense>
  );
}
