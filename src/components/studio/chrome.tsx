"use client";

import { Handle, Position } from "@xyflow/react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CreativeProgress, StudioRun } from "@/lib/types";
import type { NodeState } from "./types";

const HANDLE = "!size-2 !border-0 !bg-zinc-600 !opacity-0";

export function Handles() {
  return (
    <>
      <Handle id="l" type="target" position={Position.Left} isConnectable={false} className={HANDLE} />
      <Handle id="t" type="target" position={Position.Top} isConnectable={false} className={HANDLE} />
      <Handle id="r" type="source" position={Position.Right} isConnectable={false} className={HANDLE} />
      <Handle id="b" type="source" position={Position.Bottom} isConnectable={false} className={HANDLE} />
    </>
  );
}

export function Shell({
  step,
  label,
  icon: Icon,
  state,
  width,
  children,
  action,
  showCaption = true,
}: {
  step?: number;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  state: NodeState;
  width: number;
  children: React.ReactNode;
  action?: React.ReactNode;
  showCaption?: boolean;
}) {
  return (
    <div style={{ width }} className="relative animate-in fade-in slide-in-from-left-6 duration-500">
      {showCaption && <div className="absolute -top-7 left-1 right-1 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
          {step !== undefined && <span className="text-zinc-600">{String(step).padStart(2, "0")}</span>}
          {label}
        </div>
        <StateChip state={state} />
      </div>}
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

export function Skeleton({ text }: { text: string }) {
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

export function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">{children}</div>;
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <Label>{label}</Label>
      <div className="text-[13px] leading-snug text-zinc-200">{children}</div>
    </div>
  );
}

export function JobBar({ job }: { job: NonNullable<StudioRun["job"]> }) {
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

export function ProgressSteps({ p }: { p: CreativeProgress }) {
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
