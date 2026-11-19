"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { badgesFor, costLabel, PROVIDER_LABEL, type ClientModel } from "@/lib/registry/client";
import type { Stage } from "@/lib/registry/types";
import { useModelCatalog, type ModelCatalog } from "./use-model-catalog";

export const AUTO_ID = "auto";

interface PickerProps {
  stage: Stage;
  models: ClientModel[];
  /** Selected model id, or "auto" (video only). */
  value: string | undefined;
  onChange: (id: string) => void;
  /** Offer "Auto": product shots to Blender, text to Remotion, people to the best video model. */
  allowAuto?: boolean;
  label?: string;
  className?: string;
}

const chip = "rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] leading-none text-zinc-300";

function Row({ m, active, onPick }: { m: ClientModel; active: boolean; onPick: () => void }) {
  const unverified = m.verified === "no";
  return (
    <button
      type="button"
      disabled={!m.ready}
      onClick={onPick}
      title={m.reason ?? m.note}
      data-testid={`model-${m.id}`}
      className={cn("flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left", m.ready ? "hover:bg-white/5" : "cursor-not-allowed opacity-45", active && "bg-indigo-500/10")}
    >
      <Check className={cn("mt-0.5 size-3.5 shrink-0", active ? "text-indigo-300" : "text-transparent")} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[13px] text-zinc-100">{m.label}</span>
          {m.caps.openSource && <span className={cn(chip, "border-emerald-400/30 text-emerald-300")}>Open source</span>}
          {unverified && <span className={cn(chip, "border-amber-400/30 text-amber-300")}>Unverified</span>}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-zinc-500">
          <span>{PROVIDER_LABEL[m.provider]}</span>
          <span>·</span>
          <span>{costLabel(m.cost)}</span>
          {badgesFor(m).filter((b) => b !== "Open source").map((b) => (
            <span key={b} className={chip}>{b}</span>
          ))}
        </span>
        {!m.ready && m.reason && <span className="mt-1 block text-[10px] text-zinc-500">{m.reason}</span>}
      </span>
    </button>
  );
}

/** One stage's model picker: provider, cost and open-source badge per row; models without a key are disabled. */
export function ModelPicker({ stage, models, value, onChange, allowAuto = stage === "video" || stage === "asset3d", label, className }: PickerProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [openOnly, setOpenOnly] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const list = useMemo(() => models.filter((m) => m.stages.includes(stage)), [models, stage]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return list
      .filter((m) => (!openOnly || m.caps.openSource) && (!needle || `${m.label} ${m.provider} ${m.family}`.toLowerCase().includes(needle)))
      .sort((a, b) => Number(b.ready) - Number(a.ready));
  }, [list, q, openOnly]);
  const current = value === AUTO_ID ? null : list.find((m) => m.id === value);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className={cn("relative", className)}>
      {label && <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</div>}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={`picker-${stage}`}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-zinc-950/60 px-2.5 text-left text-[13px] text-zinc-100 hover:border-white/20"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {value === AUTO_ID && <Sparkles className="size-3.5 shrink-0 text-fuchsia-300" />}
          <span className="truncate">{value === AUTO_ID ? "Auto (recommended)" : (current?.label ?? "Choose a model")}</span>
          {current?.caps.openSource && <span className={cn(chip, "border-emerald-400/30 text-emerald-300")}>Open source</span>}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-zinc-500" />
      </button>
      {open && (
        <div role="listbox" className="absolute z-50 mt-1 w-[360px] max-w-[90vw] rounded-xl border border-white/10 bg-zinc-900 p-2 shadow-2xl">
          <div className="mb-2 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models" className="h-8 w-full rounded-md border border-white/10 bg-zinc-950/70 pl-7 pr-2 text-[12px] text-zinc-100 outline-none" />
            </div>
            <label className="flex items-center gap-1 text-[11px] text-zinc-400">
              <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Open source
            </label>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {allowAuto && (
              <button type="button" onClick={() => { onChange(AUTO_ID); setOpen(false); }} data-testid="model-auto" className={cn("mb-1 flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-white/5", value === AUTO_ID && "bg-indigo-500/10")}>
                <Sparkles className="mt-0.5 size-3.5 shrink-0 text-fuchsia-300" />
                <span>
                  <span className="block text-[13px] text-zinc-100">Auto (recommended)</span>
                  <span className="block text-[10px] text-zinc-500">{stage === "asset3d" ? "Idol Max for finals, Turbo for previews. Only used for irregular products; cans and boxes use a free Blender primitive." : "Product and label shots go to Blender (free), text to Remotion, people to the best connected video model."}</span>
                </span>
              </button>
            )}
            {shown.map((m) => (
              <Row key={m.id} m={m} active={m.id === value} onPick={() => { onChange(m.id); setOpen(false); }} />
            ))}
            {!shown.length && <div className="px-2 py-6 text-center text-[12px] text-zinc-500">No models match.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export type Picks = Partial<Record<Stage, string>>;

interface PanelProps {
  /** Current picks; a missing stage shows its default. */
  picks: Picks;
  onChange: (picks: Picks) => void;
  /** Which stages to show, in order (default: all). */
  stages?: Stage[];
  catalog?: ModelCatalog | null;
  className?: string;
}

/**
 * Every stage's picker in one grid. Self-contained: the Studio hosts it with `<ModelPickerPanel picks onChange />`
 * and stores the picks it hands back; the server turns them into run models (`sanitizePicks`).
 */
export function ModelPickerPanel({ picks, onChange, stages, catalog: given, className }: PanelProps) {
  const own = useModelCatalog();
  const catalog = given ?? own.catalog;
  if (!catalog) return <div className={cn("text-[12px] text-zinc-500", className)}>{own.error ?? "Loading models…"}</div>;
  const shown = stages ?? catalog.stages.map((s) => s.id);
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2", className)}>
      {shown.map((id) => {
        const meta = catalog.stages.find((s) => s.id === id);
        return (
          <div key={id} title={meta?.hint}>
            <ModelPicker stage={id} models={catalog.models} label={meta?.label ?? id} value={picks[id] ?? catalog.defaults[id]} onChange={(m) => onChange({ ...picks, [id]: m })} />
          </div>
        );
      })}
    </div>
  );
}
