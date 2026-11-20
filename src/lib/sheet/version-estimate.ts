import { dur, type SheetShot, type ShotSheet } from "@/lib/shot-sheet";
import { getModel } from "@/lib/registry";
import type { VersionStack } from "@/lib/versions";
import type { Version } from "./run-types";

/**
 * Version estimates from the sheet itself. Client-safe (no node imports), so Studio shows the same number the server
 * enforces. Blender and Remotion shots are free; AI-video seconds cost the stack's model price.
 */
export const DEFAULT_PER_SEC = 0.12;
export const DEFAULT_VIDEO_MODEL = "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video";

/** Neutral defaults for a shot the sheet sent to AI video but a Blender-only version renders anyway. */
export function kitFallback(s: SheetShot): NonNullable<SheetShot["blender"]> {
  const t = `${s.framing} ${s.subject} ${s.action}`.toLowerCase();
  if (/neon|glow|logo|word|title/.test(t) && s.text?.copy) return { template: "glow_word", word: s.text.copy.slice(0, 24) };
  if (/macro|ecu|engrav|label|plate/.test(t) || /ECU/.test(s.shotType)) return { template: "macro_label", label: (s.text?.copy || s.subject).slice(0, 40) };
  return { template: "lab", label: (s.text?.copy || "").slice(0, 40) || undefined, ignite: /ignit|strike|flash|glow/.test(t) ? 0.4 : undefined };
}

/** True when a version stack asks for Blender everywhere it can ("video": "auto", the Blender-heavy preset). */
export const blenderOnly = (stack?: Pick<VersionStack, "models"> | null) => stack?.models?.video === "auto";

/**
 * The sheet as one version renders it. A Blender-heavy stack sends every AI-video, 3D or world shot to the sheet's
 * Blender templates (free), whatever the lock: picking that version is the operator's choice. Other stacks keep the
 * sheet's engines and only swap the AI video model.
 */
export function shotsForStack(sheet: ShotSheet, stack?: Pick<VersionStack, "models"> | null): SheetShot[] {
  if (!blenderOnly(stack)) return sheet.shots;
  return sheet.shots.map((s) => (s.engine === "blender" || s.engine === "remotion" ? s : { ...s, engine: "blender" as const, blender: s.blender ?? kitFallback(s) }));
}

/** USD per second of a video model from the registry (falls back to the renderer default). */
export const videoPricePerSec = (model: string) => { const c = getModel(model)?.cost; return c && c.unit === "per_sec" ? c.usd : DEFAULT_PER_SEC; };

/** Rough cost of one shot check (one cheap vision call on one frame); the meter holds more and settles the real cost. */
export const SHOT_CHECK_USD = 0.003;

/**
 * What one version of this sheet will cost, from the sheet itself (not a whole-video guess): AI-video seconds at the
 * stack's model price, plus one cheap check per shot. Blender and Remotion shots are free.
 * Applies catalog per-clip minimum duration (e.g., Kling bills a 3s minimum).
 */
export function estimateSheetVersion(sheet: ShotSheet, stack: Pick<VersionStack, "models">, defaultVideoModel: string = DEFAULT_VIDEO_MODEL, tier: Version["tier"] = "preview") {
  const model = stack.models.video && stack.models.video !== "auto" ? stack.models.video : defaultVideoModel;
  const modelEntry = getModel(model);
  const minSeconds = modelEntry?.caps?.minSeconds ?? 0;
  
  const lines = shotsForStack(sheet, stack).flatMap((s) => {
    if (s.engine === "blender" || s.engine === "remotion") return [];
    
    const actualDur = dur(s);
    const billableDur = Math.max(actualDur, minSeconds);
    const cost = videoPricePerSec(model) * billableDur;
    
    return [{
      what: minSeconds > 0 && billableDur > actualDur 
        ? `shot ${s.n} (${actualDur.toFixed(1)}s, billed ${billableDur}s min)` 
        : `shot ${s.n} (${actualDur.toFixed(1)}s)`,
      model,
      usd: Number(cost.toFixed(4))
    }];
  });
  
  const checks = tier === "preview" ? sheet.shots.length * SHOT_CHECK_USD : 0.01;
  lines.push({ what: tier === "preview" ? `${sheet.shots.length} shot checks` : "final review (3 looks)", model: "qa", usd: Number(checks.toFixed(4)) });
  return { usd: Number(lines.reduce((a, l) => a + l.usd, 0).toFixed(4)), lines, blocked: [] as string[] };
}
