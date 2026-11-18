"use client";

import { useRef, useState } from "react";
import { Clapperboard, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { storyboardProofPhoto, storyboardTargets } from "@/lib/quality-policy";
import { cn } from "@/lib/utils";
import type { VideoCategory, VideoPlan } from "@/lib/types";
import { CATEGORIES, estimateCost, LENGTHS, shotCount } from "@/lib/video-categories";
import { LENSES, MUSIC_STYLES, VISUAL_STYLES } from "@/lib/video-looks";
import { useFlow } from "./context";
import { VOICE_OPTIONS } from "./constants";
import { money, storyboardPhotos } from "./utils";
import { Shell } from "./chrome";

export function VideoPlanNode() {
  const { run, form, models, act, sending, pricing } = useFlow();
  const photoInput = useRef<HTMLInputElement>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  if (!run) return null;
  const p = form.plan;
  const set = (patch: Partial<VideoPlan>) => form.set({ plan: { ...p, ...patch } });
  const shots = shotCount(p.lengthSec, p.category);
  const video = models.filter((m) => m.modality === "video" && (m.provider === "openrouter" || m.id in pricing.prices));
  const sel = "w-full rounded-md border border-white/10 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200";
  const has = run.directions.some((d) => d.shots?.length);
  const hasApproval = run.directions.some((d) => d.format === "video" && d.approvedScript);
  const eligible = storyboardTargets(run.directions, p.lengthSec);
  const photos = storyboardPhotos(run, form);
  const needsPhoto = !photos.count && eligible.some((d) => !storyboardProofPhoto(run.id, d));
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
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Lens</span>
            <select className={sel} value={p.lens ?? "auto"} onChange={(e) => set({ lens: e.target.value })}>
              {Object.entries(LENSES).map(([k, l]) => <option key={k} value={k}>{l.label}</option>)}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Visual style</span>
            <select className={sel} value={p.visualStyle ?? "natural"} onChange={(e) => set({ visualStyle: e.target.value })}>
              {Object.entries(VISUAL_STYLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Music</span>
            <select className={sel} value={p.music ? p.musicStyle ?? "auto" : "off"} onChange={(e) => set(e.target.value === "off" ? { music: false } : { music: true, musicStyle: e.target.value })}>
              <option value="off">No music</option>
              {Object.entries(MUSIC_STYLES).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">480p takes</span>
            <select className={sel} value={p.takes ?? 1} onChange={(e) => set({ takes: Number(e.target.value) })}>
              {[1, 2, 3].map((n) => <option key={n} value={n}>{n === 1 ? "1 take" : `Up to ${n} takes`}</option>)}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Budget cap / video</span>
            <input type="number" min={1} max={500} step={1} className={sel} value={p.budgetUsd} onChange={(e) => set({ budgetUsd: Math.max(1, Number(e.target.value) || 1) })} />
          </label>
          <label className="flex items-end gap-2 pb-1.5 text-xs text-zinc-300" title={pricing.realSet?.reason ?? "Build one World Labs 3D set and shoot every keyframe in it"}>
            <input type="checkbox" checked={!!p.realSet} disabled={!pricing.realSet?.available && !p.realSet} onChange={(e) => set({ realSet: e.target.checked })} /> Real set (3D world)
          </label>
        </div>
        {(() => {
          const draft = estimateCost("video", { perSec: pricing.prices[p.draftModel]?.draft, lengthSec: p.lengthSec, shots, music: p.music });
          const low = pricing.credits != null && pricing.credits < draft * 1.2;
          return (
            <div className="space-y-1 rounded-lg bg-white/[0.03] p-2 text-[11px] leading-snug text-zinc-400">
              {eligible.length > 0 && <div>Storyboards ≈ {money(estimateCost("storyboard", { lengthSec: p.lengthSec, shots: eligible.reduce((sum, d) => sum + (d.approvedScript?.beats.length ?? 0), 0) }))}</div>}
              <div>
                Per 480p take ≈ <span className={cn(draft > p.budgetUsd && "text-amber-300")}>{money(draft)}</span>{(p.takes ?? 1) > 1 ? ` · up to ${p.takes} takes, stops at the first 9/10` : ""}. HD = local upscale of the approved take (QA only, ≈ $0.10).
              </div>
              <div className={cn(low ? "text-red-300" : "text-zinc-500")}>OpenRouter spendable: {money(pricing.credits)}{low ? " · check Credits and Guardrails" : ""}</div>
              {!pricing.realSet?.available && <div className="text-zinc-500">{pricing.realSet?.reason ?? "Real set unavailable."}</div>}
              {draft > p.budgetUsd && <div className="text-amber-300">Over your cap: shorten the video, pick a cheaper model or raise the cap.</div>}
            </div>
          );
        })()}
        <div className="nodrag space-y-1">
          <div className="flex items-center justify-between gap-2 text-xs text-zinc-300">
            <span>Product photos · {photos.count}{run.storyboardPhotos?.length ? " saved" : ""}</span>
            <Button type="button" variant="outline" size="sm" disabled={sending || run.status === "working"} onClick={() => photoInput.current?.click()}>
              <Upload /> {run.storyboardPhotos?.length ? "Replace photos" : "Add product photos"}
            </Button>
            <input
              ref={photoInput}
              type="file"
              aria-label="Product photos for storyboards"
              accept="image/png,image/jpeg,image/webp"
              multiple
              hidden
              onChange={async (e) => {
                const files = Array.from(e.currentTarget.files ?? []);
                e.currentTarget.value = "";
                if (!files.length) return;
                if (files.length > 4 || files.some((f) => f.size > 5_000_000 || !/^image\/(png|jpeg|webp)$/.test(f.type))) {
                  setPhotoError("Choose up to four PNG, JPEG or WebP photos under 5 MB each.");
                  return;
                }
                try {
                  const refs = await Promise.all(files.map((f) => new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result));
                    reader.onerror = reject;
                    reader.readAsDataURL(f);
                  })));
                  const saved = await act("save_storyboard_photos", { runId: run.id, refs });
                  setPhotoError(saved ? null : "Couldn’t save the photos. Try uploading them again.");
                } catch {
                  setPhotoError("Couldn’t read the photos. Choose them again.");
                }
              }}
            />
          </div>
          {photoError && <p role="alert" className="text-xs text-amber-200">{photoError}</p>}
          {needsPhoto && <p className="text-[11px] text-amber-200">Add a real product photo to build these storyboards. A homepage link isn’t a photo.</p>}
        </div>
        <Button size="sm" className="nodrag w-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white hover:opacity-90" disabled={sending || run.status === "working" || !eligible.length || needsPhoto} onClick={() => act("storyboard", { runId: run.id, plan: p, refs: photos.refs })}>
          <Clapperboard /> {eligible.length > 0 && eligible.every((d) => d.shots?.length) ? "Rebuild storyboards" : "Build storyboards"}
        </Button>
        <p className="text-[11px] text-zinc-400">{hasApproval
          ? eligible.length
            ? `Generates image keyframes for ${eligible.length} approved ${p.lengthSec}s ${eligible.length === 1 ? "script" : "scripts"}. No video is rendered.`
            : "No approved script at this length. Build directly from an approved draft to use its length."
          : "Approve a script to unlock its storyboard."}</p>
      </div>
    </Shell>
  );
}
