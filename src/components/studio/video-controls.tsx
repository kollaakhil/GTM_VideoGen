"use client";

import { useState } from "react";
import { CheckCircle2, Film, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { draftVideoBlocker, scriptProductionBlockers, shotReady, storyboardKeyframeFixes, VIDEO_PASS } from "@/lib/quality-policy";
import { cn } from "@/lib/utils";
import type { Direction, Shot } from "@/lib/types";
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

export function VideoControls({ d }: { d: Direction }) {
  const { run, act, sending, form, pricing, models } = useFlow();
  const [draftModel, setDraftModel] = useState<string | undefined>();
  if (!run || !d.shots?.length) return null;
  const shots = d.shots;
  const plan = run.videoPlan ?? form.plan;
  const pick = draftModel ?? plan.draftModel;
  const videos = models.filter((m) => m.modality === "video" && (m.provider === "openrouter" || m.id in pricing.prices));
  const scriptFixes = scriptProductionBlockers(d.approvedScript);
  const frameFixes = storyboardKeyframeFixes(shots);
  const blocked = draftVideoBlocker(d, run.videoPlan);
  const testDraft = scriptFixes.length > 0 || frameFixes.length > 0;
  const busy = sending || run.status === "working";
  const takes = (d.takes ?? []).filter((t) => t.storyboardKey === d.storyboardKey);
  const approved = takes.find((t) => t.id === d.approvedTakeId);
  const seconds = shots.reduce((sum, shot) => sum + shot.seconds, 0);
  const perSec = (id: string) => pricing.prices[id]?.draft;
  const estimate = money(estimateCost("video", { perSec: perSec(pick), lengthSec: seconds, shots: shots.length, music: plan.music }));
  const takeCount = plan.takes ?? 1;

  return (
    <section aria-label="Video generation" className="nodrag space-y-2 rounded-lg border border-indigo-400/20 bg-indigo-500/5 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-zinc-100">Video plan checkpoint</h3>
        <span className={cn("text-[11px]", blocked ? "text-amber-200" : "text-emerald-300")}>{blocked ? "Blocked" : approved ? "Take approved" : "Previews available"}</span>
      </div>
      <div className="nowheel flex gap-1.5 overflow-x-auto pb-1">
        {shots.map((shot) => <ShotThumb key={shot.id} d={d} s={shot} />)}
      </div>
      <details className="text-[11px] text-zinc-400">
        <summary className="cursor-pointer">Per-shot model and lens</summary>
        <div className="mt-1 space-y-1">
          {shots.map((s, i) => (
            <div key={s.id} className="grid grid-cols-[44px_1fr_1fr] items-center gap-1">
              <span className="truncate text-[10px] uppercase text-zinc-500">{i + 1}. {s.beat}</span>
              <select aria-label={`Model for shot ${i + 1}`} className={small} value={s.model ?? ""} disabled={busy} onChange={(e) => act("shot_settings", { runId: run.id, directionId: d.id, shotId: s.id, model: e.target.value || undefined })}>
                <option value="">Plan model</option>
                {videos.map((m) => <option key={m.id} value={m.id}>{m.label}{perSec(m.id) != null ? ` · $${perSec(m.id)!.toFixed(3)}/s` : ""}</option>)}
              </select>
              <select aria-label={`Lens for shot ${i + 1}`} className={small} value={s.lens ?? "auto"} disabled={busy} onChange={(e) => act("shot_settings", { runId: run.id, directionId: d.id, shotId: s.id, lens: e.target.value })}>
                {Object.entries(LENSES).map(([k, l]) => <option key={k} value={k}>{k === "auto" ? "Plan lens" : l.label}</option>)}
              </select>
            </div>
          ))}
          <p className="text-[10px] text-zinc-500">A lens change applies to the clip right away; redraw the keyframe to reframe the still too.</p>
        </div>
      </details>
      <label className="block text-[11px] text-zinc-400">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">Preview model</span>
        <select aria-label="Draft video model" className={small} value={pick} onChange={(e) => setDraftModel(e.target.value)}>
          {videos.map((m) => <option key={m.id} value={m.id}>{m.label}{perSec(m.id) != null ? ` · $${perSec(m.id)!.toFixed(3)}/s` : ""}</option>)}
        </select>
      </label>
      <Button size="sm" className="w-full" disabled={busy || !!blocked} onClick={() => act("render_video", { runId: run.id, directionId: d.id, tier: "draft", draftModel: pick, takes: takeCount })}>
        <Film /> {takes.length ? "Another" : "Make"} {takeCount > 1 ? `up to ${takeCount} 480p takes` : "a 480p take"}{!blocked ? ` · ≈ ${estimate}${takeCount > 1 ? " each" : ""}` : ""}
      </Button>
      {blocked ? <p className="text-[11px] text-amber-200">{blocked}</p> : testDraft && (
        <p className="text-[11px] text-zinc-300">Test the workflow with these previews. Quality warnings won’t block them, but they can’t go to HD or publishing.</p>
      )}
      {scriptFixes.length > 0 && (
        <details className="text-[11px] text-amber-200">
          <summary className="cursor-pointer">{scriptFixes.length} script {scriptFixes.length === 1 ? "fix" : "fixes"} before HD</summary>
          <ul className="mt-1 list-disc space-y-1 pl-4">{scriptFixes.map((fix) => <li key={fix}>{fix}</li>)}</ul>
        </details>
      )}
      {!!frameFixes.length && (
        <p className="text-[11px] text-amber-200">Before HD, redraw {frameFixes.length === 1 ? "keyframe" : "keyframes"} {frameFixes.join(", ")} to match the shot and score {VIDEO_PASS}/10.</p>
      )}
      {takes.length > 0 && (
        <div className="space-y-1.5" aria-label="480p takes">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">480p takes · approve one to upscale</div>
          {takes.map((t, i) => (
            <div key={t.id} className={cn("flex items-center gap-2 rounded-md border p-1.5", t.id === d.approvedTakeId ? "border-emerald-400/50 bg-emerald-500/10" : "border-white/10")}>
              <video src={t.url} controls muted playsInline preload="metadata" className="h-16 w-9 shrink-0 rounded bg-black object-cover" />
              <div className="min-w-0 flex-1 text-[11px] text-zinc-300">
                <div>Take {i + 1} · <span className={t.pass ? "text-emerald-300" : "text-amber-200"}>{t.score}/10</span> · {money(t.costUsd)}</div>
                <div className="truncate text-[10px] text-zinc-500">{[...new Set(t.clips.map((c) => c.model.split("/").slice(-2).join("/")))].join(", ")}</div>
                {!!t.stages?.length && (
                  <div className="flex gap-1.5 text-[10px]" title={t.stages.map((g) => `${g.stage} ${g.score}/10: ${g.checks.map((c) => `${c.name} ${c.score}`).join(", ")}`).join("\n")}>
                    {t.stages.map((g) => <span key={g.stage} className={g.pass ? "text-emerald-300" : "text-amber-200"}>{g.stage} {g.score}</span>)}
                  </div>
                )}
              </div>
              {t.id === d.approvedTakeId ? (
                <span className="flex items-center gap-1 text-[11px] text-emerald-300"><CheckCircle2 className="size-3.5" /> Approved</span>
              ) : (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => act("approve_take", { runId: run.id, directionId: d.id, takeId: t.id })}>Approve</Button>
              )}
            </div>
          ))}
        </div>
      )}
      {approved ? (
        <Button size="sm" variant="outline" className="w-full" disabled={busy || testDraft} onClick={() => act("render_video", { runId: run.id, directionId: d.id, tier: "final" })}>
          <Sparkles /> Upscale approved take to HD · free{pricing.upscaler === false ? " (Lanczos: Real-ESRGAN not found)" : " (Real-ESRGAN)"} + QA ≈ $0.10
        </Button>
      ) : (
        !testDraft && <p className="text-[11px] text-zinc-400">Approve a take to unlock the HD upscale. Upscaling keeps the exact shots, voice and music.</p>
      )}
    </section>
  );
}
