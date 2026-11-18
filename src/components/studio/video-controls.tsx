"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Film, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { draftVideoBlocker, shotReady } from "@/lib/quality-policy";
import { finalBlockers } from "@/lib/stage-policy";
import { fmtSec as fmt, jobView } from "@/lib/job-progress";
import { cn } from "@/lib/utils";
import type { Direction, JobPhase, JobProgress, Shot, StudioRun } from "@/lib/types";
import { estimateCost } from "@/lib/video-categories";
import { LENSES } from "@/lib/video-looks";
import { useFlow } from "./context";
import { money } from "./utils";

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
      {score != null && <span className={cn("absolute left-1 top-1 rounded px-1 text-[9px] font-semibold text-black", shotReady(s.clipQa ?? s.keyframeQa) ? "bg-emerald-400" : "bg-amber-300")}>{score}</span>}
      {s.clip && <Film className="absolute bottom-5 left-1 size-3 text-white drop-shadow" />}
      <button
        aria-label="Redraw shot"
        disabled={sending || run?.status === "working"}
        onClick={() => act("redo_shot", { runId: run!.id, directionId: d.id, shotId: s.id, refs: form.refs })}
        className="absolute right-1 top-1 rounded bg-black/70 p-0.5 text-white disabled:opacity-40"
      >
        <RefreshCw className="size-3" />
      </button>
      <div className="mt-0.5 truncate text-[9px] uppercase tracking-wide text-zinc-500">{s.beat}</div>
    </div>
  );
}

const small = "w-full truncate rounded-md border border-white/10 bg-zinc-950 px-1.5 py-1 text-[10px] text-zinc-300";

const STAGE_LABEL: Record<JobPhase, string> = {
  queued: "Queued", preflight: "Preflight", voice: "Voice & music", rendering: "Rendering", qa: "QA",
  stitching: "Stitching", upscaling: "Upscaling", done: "Done", failed: "Failed",
};
function useNow(active: boolean) {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setT(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return t;
}

function Progress({ job, d }: { job: JobProgress; d: Direction }) {
  const t = useNow(true);
  const v = jobView(job, t);
  return (
    <div className="space-y-1.5 rounded-md border border-indigo-400/30 bg-indigo-500/10 p-2" aria-label="Video job progress" role="status">
      <div className="flex justify-between text-[11px] text-zinc-200">
        <span className="truncate pr-2">{STAGE_LABEL[job.phase ?? "queued"]} · {job.label}</span>
        <span className="shrink-0 tabular-nums">{v.pct}%{v.eta != null ? ` · ~${fmt(v.eta)} left` : ""}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-fuchsia-400 transition-all duration-700" style={{ width: `${Math.max(3, v.pct)}%` }} />
      </div>
      {v.shots.map((s, i) => (
        <div key={s.id} className="grid grid-cols-[52px_1fr_92px] items-center gap-1.5 text-[10px] text-zinc-400">
          <span className="truncate">Shot {i + 1}{d.shots?.[i] ? ` · ${d.shots[i].beat}` : ""}</span>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className={cn("h-full rounded-full transition-all duration-700", s.stage === "failed" ? "bg-red-400" : s.stage === "done" ? "bg-emerald-400" : "bg-indigo-400")} style={{ width: `${Math.max(2, s.pct)}%` }} />
          </div>
          <span className="truncate text-right tabular-nums">{STAGE_LABEL[s.stage]} {s.pct}%{s.eta ? ` · ${fmt(s.eta)}` : ""}</span>
        </div>
      ))}
      <div className="text-[10px] text-zinc-500">Running in the background for {fmt(v.elapsed)}. You can leave this page.</div>
    </div>
  );
}

function StepHeader({ n, title, state }: { n: number; title: string; state: "done" | "active" | "todo" }) {
  return (
    <div className={cn("flex items-center gap-1.5 text-[11px] font-semibold", state === "todo" ? "text-zinc-500" : "text-zinc-100")}>
      <span className={cn("grid size-4 place-items-center rounded-full text-[9px]", state === "done" ? "bg-emerald-500 text-black" : state === "active" ? "bg-indigo-500 text-white" : "bg-white/10")}>{state === "done" ? "✓" : n}</span>
      {title}
    </div>
  );
}

/** Retry only re-sends the failed request for this direction. */
function Failure({ run, d }: { run: StudioRun; d: Direction }) {
  const { act, sending } = useFlow();
  const f = run.failure;
  if (run.status !== "error" || !f || (f.directionId && f.directionId !== d.id)) return null;
  return (
    <div role="alert" className="space-y-1 rounded-md border border-red-400/30 bg-red-500/10 p-2 text-[11px] text-red-200">
      <div className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /><span className="line-clamp-5">{f.message}</span></div>
      {f.retry && <Button size="sm" variant="outline" disabled={sending} onClick={() => act(String(f.retry!.action), f.retry)}><RefreshCw /> Retry</Button>}
    </div>
  );
}

/**
 * The video step as one line: storyboard → 480p previews → pick one → final video → player and download.
 * Model, lens and per-shot settings stay under Customize.
 */
export function VideoControls({ d }: { d: Direction }) {
  const { run, act, sending, form, pricing, models } = useFlow();
  const [draftModel, setDraftModel] = useState<string | undefined>();
  if (!run || !d.shots?.length) return null;
  const shots = d.shots;
  const plan = run.videoPlan ?? form.plan;
  const perSec = (id: string) => pricing.prices[id]?.draft;
  const videos = models.filter((m) => m.modality === "video" && (m.provider === "openrouter" || m.id in pricing.prices));
  // Default to a model with a known price (Higgsfield needs its own sign-in); cheapest first.
  const priced = videos.filter((m) => perSec(m.id) != null).sort((a, b) => perSec(a.id)! - perSec(b.id)!);
  const pick = draftModel ?? (perSec(plan.draftModel) != null ? plan.draftModel : priced[0]?.id ?? plan.draftModel);
  const blocked = draftVideoBlocker(d, run.videoPlan);
  const working = run.status === "working";
  const mine = working && run.job?.directionId === d.id;
  const busy = sending || working;
  const takes = (d.takes ?? []).filter((t) => t.storyboardKey === d.storyboardKey);
  const approved = takes.find((t) => t.id === d.approvedTakeId);
  const final = approved?.upscaledUrl ? approved : takes.find((t) => t.upscaledUrl);
  const seconds = shots.reduce((sum, shot) => sum + shot.seconds, 0);
  const takeCount = plan.takes ?? 1;
  const estimate = money(estimateCost("video", { perSec: perSec(pick), lengthSec: seconds, shots: shots.length, music: plan.music }));
  const warnings = approved ? finalBlockers(run, d.id) : [];
  const finalJob = mine && run.job?.phase === "upscaling";
  const makeFinal = (acceptWarnings: boolean) => act("render_video", { runId: run.id, directionId: d.id, tier: "final", ...(acceptWarnings ? { acceptWarnings } : {}) });

  return (
    <section aria-label="Video generation" className="nodrag space-y-2.5 rounded-lg border border-indigo-400/20 bg-indigo-500/5 p-2.5">
      <StepHeader n={1} title="Storyboard" state="done" />
      <div className="nowheel flex gap-1.5 overflow-x-auto pb-1">
        {shots.map((shot) => <ShotThumb key={shot.id} d={d} s={shot} />)}
      </div>
      <details className="text-[11px] text-zinc-400">
        <summary className="cursor-pointer">Customize</summary>
        <div className="mt-1 space-y-1">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Preview model</span>
            <select aria-label="Draft video model" className={small} value={pick} onChange={(e) => setDraftModel(e.target.value)}>
              {videos.map((m) => <option key={m.id} value={m.id}>{m.label}{perSec(m.id) != null ? ` · $${perSec(m.id)!.toFixed(3)}/s` : ""}</option>)}
            </select>
          </label>
          {shots.map((s, i) => (
            <div key={s.id} className="grid grid-cols-[44px_1fr_1fr] items-center gap-1">
              <span className="truncate text-[10px] uppercase text-zinc-500">{i + 1}. {s.beat}</span>
              <select aria-label={`Model for shot ${i + 1}`} className={small} value={s.model ?? ""} disabled={busy} onChange={(e) => act("shot_settings", { runId: run.id, directionId: d.id, shotId: s.id, model: e.target.value || undefined })}>
                <option value="">Preview model</option>
                {videos.map((m) => <option key={m.id} value={m.id}>{m.label}{perSec(m.id) != null ? ` · $${perSec(m.id)!.toFixed(3)}/s` : ""}</option>)}
              </select>
              <select aria-label={`Lens for shot ${i + 1}`} className={small} value={s.lens ?? "auto"} disabled={busy} onChange={(e) => act("shot_settings", { runId: run.id, directionId: d.id, shotId: s.id, lens: e.target.value })}>
                {Object.entries(LENSES).map(([k, l]) => <option key={k} value={k}>{k === "auto" ? "Plan lens" : l.label}</option>)}
              </select>
            </div>
          ))}
        </div>
      </details>

      <StepHeader n={2} title="480p previews" state={takes.length ? "done" : "active"} />
      {mine && run.job && !finalJob && <Progress job={run.job} d={d} />}
      <Failure run={run} d={d} />
      {!mine && (
        <Button size="sm" className="w-full" disabled={busy || !!blocked} onClick={() => act("render_video", { runId: run.id, directionId: d.id, tier: "draft", draftModel: pick, takes: takeCount })}>
          <Film /> {takes.length ? "Make another preview" : `Make 480p preview${takeCount > 1 ? "s" : ""}`}{!blocked ? ` · ≈ ${estimate}${takeCount > 1 ? " each" : ""}` : ""}
        </Button>
      )}
      {working && !mine && <p className="text-[11px] text-zinc-400">Another step is running on this run. This unlocks when it finishes.</p>}
      {blocked && <p className="text-[11px] text-amber-200">{blocked}</p>}

      {takes.length > 0 && (
        <>
          <StepHeader n={3} title="Pick one" state={approved ? "done" : "active"} />
          <div className="grid grid-cols-2 gap-1.5" aria-label="480p previews">
            {takes.map((t, i) => (
              <div key={t.id} className={cn("space-y-1 rounded-md border p-1.5", t.id === d.approvedTakeId ? "border-emerald-400/60 bg-emerald-500/10" : "border-white/10")}>
                <video src={t.url} controls muted playsInline preload="metadata" className="aspect-[9/16] w-full rounded bg-black object-cover" />
                <div className="flex items-center justify-between text-[10px] text-zinc-300">
                  <span>Preview {i + 1}</span>
                  <span className={t.pass ? "text-emerald-300" : "text-amber-200"} title={t.stages?.map((g) => `${g.stage} ${g.score}/10`).join(" · ")}>QA {t.score}/10</span>
                </div>
                {t.id === d.approvedTakeId ? (
                  <div className="flex items-center justify-center gap-1 text-[11px] text-emerald-300"><CheckCircle2 className="size-3.5" /> Picked</div>
                ) : (
                  <Button size="sm" variant="outline" className="w-full" disabled={busy} onClick={() => act("approve_take", { runId: run.id, directionId: d.id, takeId: t.id })}>Use this one</Button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {approved && (
        <>
          <StepHeader n={4} title="Final video" state={final ? "done" : "active"} />
          {finalJob && run.job && <Progress job={run.job} d={d} />}
          {!mine && !warnings.length && (
            <Button size="sm" className="w-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white hover:opacity-90" disabled={busy} onClick={() => makeFinal(false)}>
              <Sparkles /> {final ? "Remake final video" : "Make final video"} · HD upscale + voice & music ≈ $0.10
            </Button>
          )}
          {!mine && warnings.length > 0 && (
            <div className="space-y-1">
              <details className="text-[11px] text-amber-200">
                <summary className="cursor-pointer">{warnings.length} quality {warnings.length === 1 ? "warning" : "warnings"}: the final video won’t be publishable</summary>
                <ul className="mt-1 list-disc space-y-1 pl-4">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              </details>
              <Button size="sm" className="w-full" variant="outline" disabled={busy} onClick={() => makeFinal(true)}>
                <Sparkles /> {final ? "Remake final video anyway" : "Make final video anyway"} · ≈ $0.10
              </Button>
            </div>
          )}
        </>
      )}

      {final?.upscaledUrl && (
        <>
          <StepHeader n={5} title="Done" state="done" />
          <video src={final.upscaledUrl} controls playsInline preload="metadata" className="aspect-[9/16] w-full rounded-md bg-black" aria-label="Final video" />
          <div className="flex items-center justify-between text-[11px] text-zinc-300">
            <span>Final QA {final.finalScore ?? "?"}/10</span>
            <a href={final.upscaledUrl} download className="flex items-center gap-1 font-medium text-indigo-300 hover:underline"><Download className="size-3.5" /> Download MP4</a>
          </div>
        </>
      )}
    </section>
  );
}
