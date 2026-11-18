"use client";

import { useState } from "react";
import { Film, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { draftVideoBlocker, scriptProductionBlockers, shotReady, storyboardKeyframeFixes, VIDEO_PASS } from "@/lib/quality-policy";
import { cn } from "@/lib/utils";
import type { Direction, Shot } from "@/lib/types";
import { estimateCost } from "@/lib/video-categories";
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

export function VideoControls({ d }: { d: Direction }) {
  const { run, act, sending, form, pricing, models } = useFlow();
  const [vm, setVm] = useState<{ draft?: string; final?: string }>({});
  if (!run || !d.shots?.length) return null;
  const shots = d.shots;
  const plan = run.videoPlan ?? form.plan;
  const pick = { draft: vm.draft ?? plan.draftModel, final: vm.final ?? plan.finalModel };
  const videos = models.filter((m) => m.modality === "video" && (m.provider === "openrouter" || m.id in pricing.prices));
  const scriptFixes = scriptProductionBlockers(d.approvedScript);
  const frameFixes = storyboardKeyframeFixes(shots);
  const blocked = draftVideoBlocker(d, run.videoPlan);
  const testDraft = scriptFixes.length > 0 || frameFixes.length > 0;
  const hdReady = !blocked && !testDraft && d.passingDraft === d.storyboardKey;
  const busy = sending || run.status === "working";
  const generate = (tier: "draft" | "final") => act("render_video", { runId: run.id, directionId: d.id, tier, draftModel: pick.draft, finalModel: pick.final });
  const estimate = (tier: "draft" | "final") => money(estimateCost("video", { perSec: pricing.prices[pick[tier]]?.[tier], lengthSec: shots.reduce((sum, shot) => sum + shot.seconds, 0), shots: shots.length, music: plan.music }));

  return (
    <section aria-label="Video generation" className="nodrag space-y-2 rounded-lg border border-indigo-400/20 bg-indigo-500/5 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-zinc-100">Generate video</h3>
        <span className={cn("text-[11px]", blocked ? "text-amber-200" : "text-emerald-300")}>{blocked ? "Blocked" : "Draft available"}</span>
      </div>
      <div className="nowheel flex gap-1.5 overflow-x-auto pb-1">
        {shots.map((shot) => <ShotThumb key={shot.id} d={d} s={shot} />)}
      </div>
      <Button size="sm" className="w-full" disabled={busy || !!blocked} onClick={() => generate("draft")}>
        <Film /> Generate 480p draft{!blocked ? ` · ≈ ${estimate("draft")}` : ""}
      </Button>
      {blocked ? <p className="text-[11px] text-amber-200">{blocked}</p> : testDraft && (
        <p className="text-[11px] text-zinc-300">Test the workflow with this draft. Quality warnings won’t block it, but it can’t go to HD or publishing.</p>
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
      {hdReady ? (
        <Button size="sm" variant="outline" className="w-full" disabled={busy} onClick={() => generate("final")}>
          Upgrade to HD · ≈ {estimate("final")}
        </Button>
      ) : (
        !testDraft && <p className="text-[11px] text-zinc-400">A passing draft unlocks HD.</p>
      )}
      <details className="text-[11px] text-zinc-400">
        <summary className="cursor-pointer">Video models</summary>
        <div className="mt-1 grid grid-cols-2 gap-1.5">
          {(["draft", "final"] as const).map((tier) => (
            <select
              key={tier}
              aria-label={tier === "draft" ? "Draft video model" : "HD video model"}
              className="w-full truncate rounded-md border border-white/10 bg-zinc-950 px-1.5 py-1 text-[10px] text-zinc-300"
              value={pick[tier]}
              onChange={(e) => setVm({ ...vm, [tier]: e.target.value })}
            >
              {videos.map((m) => (
                <option key={m.id} value={m.id}>{m.label}{pricing.prices[m.id]?.[tier] != null ? ` · $${pricing.prices[m.id][tier]!.toFixed(3)}/s` : ""}</option>
              ))}
            </select>
          ))}
        </div>
      </details>
    </section>
  );
}
