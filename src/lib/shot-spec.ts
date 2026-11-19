import type { Shot, ShotSpec } from "./types";

/**
 * Structured shot instructions. Free-text "visual" lines let the video model guess the lens, how big the product is
 * and when things happen; that is where hands warp mid-move and labels melt. Every shot now carries a spec, and the
 * keyframe and video prompts are built from it in a fixed order, with a negative prompt.
 */
export const DEFAULT_NEGATIVE = [
  "warped, fused or extra fingers", "melting, misspelled or re-drawn product label", "garbled or invented text, letters or logos",
  "phone screens or UI", "product rotating away from camera", "duplicate or morphing products", "flicker, jump cuts or sudden zooms", "plastic CGI look",
];

const MM = /(\d{2,3})\s?mm/i;

/** Lens focal length in mm from a spec, a camera line or a lens hint ("macro" → 100, "wide" → 24…). */
export function lensMm(text: string): number | null {
  const m = text.match(MM);
  if (m) return Number(m[1]);
  if (/macro/i.test(text)) return 100;
  if (/telephoto|compressed/i.test(text)) return 85;
  if (/close-?up|portrait/i.test(text)) return 50;
  if (/\bwide\b|establishing/i.test(text)) return 24;
  return null;
}

/** Missing or vague parts of a spec, for the shot-plan gate and the planner's retry notes. */
export function specGaps(s: Pick<Shot, "spec" | "id">): string[] {
  const p = s.spec;
  if (!p) return [`${s.id}: no structured spec`];
  const out: string[] = [];
  if (!p.subject?.trim()) out.push(`${s.id}: name the subject`);
  if (!p.productFraming?.trim()) out.push(`${s.id}: say how the product is framed (size in frame, angle, label facing camera)`);
  if (!p.lensMm || p.lensMm < 12 || p.lensMm > 200) out.push(`${s.id}: give a lens in mm`);
  if (!p.cameraMove?.trim()) out.push(`${s.id}: one camera move`);
  if (!p.lighting?.trim()) out.push(`${s.id}: describe the light`);
  if (!p.setting?.trim()) out.push(`${s.id}: describe the setting`);
  if (!p.motionBeats?.length || p.motionBeats.length > 3) out.push(`${s.id}: 1–3 timed motion beats`);
  return out;
}

/** The fixed-order prompt block for one shot (keyframes and video both use it). */
export function specBlock(s: Shot): string {
  const p = s.spec;
  if (!p) return "";
  const beats = p.motionBeats?.length ? ` Motion: ${p.motionBeats.join(" → ")}.` : "";
  return `Subject: ${p.subject}. Product: ${p.productFraming}. Setting: ${p.setting}. Light: ${p.lighting}. Lens: ${p.lensMm}mm. Camera: ${p.cameraMove}.${beats}`;
}

export function negativePrompt(s: Shot): string {
  return [...new Set([...(s.spec?.negative ?? []), ...DEFAULT_NEGATIVE])].slice(0, 12).join(", ");
}

/** Coerces the planner's spec (may be partial or loosely typed) into a ShotSpec. */
export function toSpec(raw: unknown, fallback: { visual: string; camera: string }): ShotSpec {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === "string" ? (r[k] as string).trim().slice(0, 300) : "");
  const mm = typeof r.lensMm === "number" ? r.lensMm : lensMm(`${str("lensMm")} ${fallback.camera} ${fallback.visual}`);
  const arr = (k: string) => (Array.isArray(r[k]) ? (r[k] as unknown[]).filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 160)) : []);
  return {
    subject: str("subject"), productFraming: str("productFraming"), lensMm: mm ?? 0, cameraMove: str("cameraMove") || fallback.camera,
    lighting: str("lighting"), setting: str("setting"), motionBeats: arr("motionBeats").slice(0, 3), negative: arr("negative").slice(0, 6),
  };
}
