"use client";

import { ENGINES, BLENDER_TEMPLATES, TRANSITIONS, type ShotSheet, type SheetShot } from "@/lib/shot-sheet";
import { setShotLength, tc } from "@/lib/sheet/timing";
import { cn } from "@/lib/utils";

const cell = "w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs outline-none hover:border-zinc-700 focus:border-zinc-500 focus:bg-zinc-900";

function T({ v, on, rows = 2, w }: { v: string; on: (v: string) => void; rows?: number; w?: string }) {
  return <textarea rows={rows} value={v} onChange={(e) => on(e.target.value)} className={cn(cell, "resize-y", w)} />;
}

/** The editable shot sheet: one row per shot, every column the renders and the edit read. */
export function SheetTable({ sheet, onChange, issues }: { sheet: ShotSheet; onChange: (s: ShotSheet) => void; issues: Record<number, string[]> }) {
  const set = (i: number, patch: Partial<SheetShot>) => onChange({ ...sheet, shots: sheet.shots.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  // Changing one shot's length keeps it and refits the others, so the sheet always sums to the target.
  const setLen = (i: number, len: number) => Number.isFinite(len) && len > 0 && onChange(setShotLength(sheet, i, len));
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800">
      <table className="w-full min-w-[1500px] border-collapse text-left text-xs" data-testid="shot-sheet">
        <thead className="bg-zinc-900 text-[10px] uppercase tracking-wider text-zinc-400">
          <tr>
            {["#", "Time", "Shot / framing", "Camera (angle · move · lens)", "Subject · action", "Lighting", "On-screen text", "Sound (VO · SFX · music)", "Out", "Engine", "Editor note"].map((h) => <th key={h} className="px-2 py-2 font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {sheet.shots.map((s, i) => (
            <tr key={s.id} className={cn("border-t border-zinc-800 align-top", issues[s.n]?.length && "bg-red-950/30")}>
              <td className="px-2 py-1.5 font-mono text-zinc-400">{s.n}</td>
              <td className="px-2 py-1.5 font-mono whitespace-nowrap">
                <div>{tc(s.start)}</div>
                <div className="text-zinc-500">{tc(s.end)}</div>
                <input type="number" step={0.1} min={0.6} max={8} value={Number((s.end - s.start).toFixed(2))} onChange={(e) => setLen(i, Number(e.target.value))} className={cn(cell, "mt-1 w-16 border-zinc-800")} title="Length (s); the other shots refit so the total stays on target" />
              </td>
              <td className="w-40 px-1 py-1"><input value={s.shotType} onChange={(e) => set(i, { shotType: e.target.value })} className={cn(cell, "font-semibold")} /><T v={s.framing} on={(v) => set(i, { framing: v })} /></td>
              <td className="w-48 px-1 py-1">
                <input value={s.camera.angle} onChange={(e) => set(i, { camera: { ...s.camera, angle: e.target.value } })} className={cell} />
                <input value={s.camera.move} onChange={(e) => set(i, { camera: { ...s.camera, move: e.target.value } })} className={cell} />
                <div className="flex items-center gap-1"><input type="number" value={s.camera.lensMm} onChange={(e) => set(i, { camera: { ...s.camera, lensMm: Number(e.target.value) } })} className={cn(cell, "w-16")} /><span className="text-zinc-500">mm</span></div>
              </td>
              <td className="w-56 px-1 py-1"><T v={s.subject} on={(v) => set(i, { subject: v })} /><T v={s.action} on={(v) => set(i, { action: v })} /></td>
              <td className="w-40 px-1 py-1"><T v={s.lighting} on={(v) => set(i, { lighting: v })} rows={3} /></td>
              <td className="w-40 px-1 py-1">
                <T v={s.text?.copy ?? ""} on={(v) => set(i, { text: v.trim() ? { copy: v, placement: s.text?.placement ?? "lower third" } : null })} />
                {s.text && <input value={s.text.placement} onChange={(e) => set(i, { text: { ...s.text!, placement: e.target.value } })} className={cn(cell, "text-zinc-400")} />}
              </td>
              <td className="w-56 px-1 py-1">
                {sheet.audioMode === "vo" && <T v={s.audio.vo ?? ""} on={(v) => set(i, { audio: { ...s.audio, vo: v || null } })} />}
                <input placeholder="SFX" value={s.audio.sfx ?? ""} onChange={(e) => set(i, { audio: { ...s.audio, sfx: e.target.value || null } })} className={cell} />
                <input placeholder="Music cue" value={s.audio.music ?? ""} onChange={(e) => set(i, { audio: { ...s.audio, music: e.target.value || null } })} className={cn(cell, "text-zinc-400")} />
              </td>
              <td className="px-1 py-1">
                <select value={s.transition} onChange={(e) => set(i, { transition: e.target.value as SheetShot["transition"] })} className={cn(cell, "w-24")}>{TRANSITIONS.map((t) => <option key={t}>{t}</option>)}</select>
              </td>
              <td className="w-36 px-1 py-1">
                <select value={s.engine} onChange={(e) => set(i, { engine: e.target.value as SheetShot["engine"], engineLocked: true })} className={cell}>{ENGINES.map((t) => <option key={t}>{t}</option>)}</select>
                {(s.engine === "blender" || s.engine === "3d") && (
                  <select value={s.blender?.template ?? ""} onChange={(e) => set(i, { blender: { ...(s.blender ?? {}), template: e.target.value as (typeof BLENDER_TEMPLATES)[number] } })} className={cn(cell, "text-zinc-400")}>
                    <option value="">auto template</option>{BLENDER_TEMPLATES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                )}
                {s.engine === "ai_video" && <T v={s.prompt ?? ""} on={(v) => set(i, { prompt: v || undefined })} rows={3} />}
                {s.engineLocked && <div className="text-[10px] text-amber-400">locked by you</div>}
              </td>
              <td className="w-40 px-1 py-1">
                <T v={s.editorNote} on={(v) => set(i, { editorNote: v })} />
                {issues[s.n]?.map((t) => <div key={t} className="mt-1 text-[10px] text-red-400">{t}</div>)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
