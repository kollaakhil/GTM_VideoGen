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
export function specGaps(s: Pick<Shot, "spec" | "id"> & Partial<Pick<Shot, "source" | "visual">>): string[] {
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
  return [...out, ...labelLockGaps(s)];
}

/** The fixed-order prompt block for one shot (keyframes and video both use it). */
export function specBlock(s: Shot): string {
  const p = s.spec;
  if (!p) return "";
  const beats = p.motionBeats?.length ? ` Motion: ${p.motionBeats.join(" → ")}.` : "";
  const locks = p.continuity?.length ? ` Continuity: ${p.continuity.join("; ")}.` : "";
  return `Subject: ${p.subject}. Product: ${p.productFraming}. Setting: ${p.setting}. Light: ${p.lighting}. Lens: ${p.lensMm}mm. Camera: ${p.cameraMove}.${beats}${locks}`;
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

// ---------- Label lock and continuity locks (PLAYBOOK 13.33–13.34) ----------
// Evidence: across ~6 Seedance renders of a tilt-pour, one kept the label legible; every take's weakest scene was the
// labelled can tilting or rotating. Rule: a labelled product never tilts, tips, lifts or rotates in frame. A pour comes
// from a can held out of frame (only the stream is visible), and the labelled can stands upright and still beside the glass.

const MOVES = /\b(tilt\w*|tip|tips|tipping|tipped|rotat\w*|spin\w*|twist\w*|turns?|turning|flip\w*|lift\w*|rais\w*|upend\w*|pick\w* up)\b/i;
const POUR = /\b(pour\w*|stream\w*)\b/i;
const CAN = /\b(can|bottle|jar|carton|box|pack|tin)\b/i;
const OFF_FRAME = /\b(out of frame|off-?frame|off-?screen)\b/i;
const TIME = /^\s*([\d.]+\s*[–-]\s*[\d.]+\s*s)\b/;

// Positive wording only in prompts (naming "tilt" primes video models to tilt); the negations live in LABEL_NEGATIVE.
export const LABEL_LOCK = "the labelled can stands upright and still beside the glass, front label square to camera";
export const OFF_FRAME_POUR = "cola pours into the glass from a can held above, out of frame (only the stream is visible)";
export const LABEL_NEGATIVE = ["can tilting, tipping or lifting", "label rotating or turning away"];

/** A shot that shows the real labelled product (the Blender packshot is exempt: it is rendered, not generated). */
export function labelled(s: Partial<Pick<Shot, "spec" | "source" | "visual">>): boolean {
  if (s.source === "packshot") return false;
  const f = s.spec?.productFraming ?? "";
  return /\blabel\b/i.test(`${f} ${s.visual ?? ""}`) && !/\b(no product|product not in frame|without the product)\b/i.test(f);
}

/** True when a line asks the product itself to move (tilt, rotate, lift), or to pour from a can that is in frame. */
export function movesProduct(line: string): boolean {
  if (OFF_FRAME.test(line)) return false;
  return MOVES.test(line) || (POUR.test(line) && CAN.test(line));
}

/** Spec lines that break the label lock, for the shot-plan gate and the planner's retry notes. */
export function labelLockGaps(s: Pick<Shot, "spec" | "id"> & Partial<Pick<Shot, "source" | "visual">>): string[] {
  if (!labelled(s) || !s.spec) return [];
  return (s.spec.motionBeats ?? []).filter(movesProduct).map((b) => `${s.id}: the labelled product must not move ("${b.slice(0, 60)}"); pour from out of frame, can upright and still`);
}

/** Product framing without clauses that move the product or pour from it ("held steady while pouring"). */
const lockFraming = (f: string) => f.split(/(?<=[.;,])\s+/).filter((c) => !movesProduct(c) && !POUR.test(c)).join(" ").replace(/[.;,\s]+$/, "");

const sentences = (t: string) => t.split(/(?<=[.!?])\s+/).filter(Boolean);

/**
 * Enforces the label lock in code, so it never depends on the planner obeying a prompt: product-moving beats become
 * an upright still can plus an off-frame pour, the visual loses its tilt/pour sentences, a pour shot gets a locked-off
 * camera, and the negative prompt names the failure.
 */
export function applyLabelLock(s: Shot): Shot {
  if (!labelled(s) || !s.spec) return s;
  const bad = s.spec.motionBeats.filter(movesProduct);
  const visualBad = sentences(s.visual).some(movesProduct);
  if (!bad.length && !visualBad && /always upright/i.test(s.spec.productFraming)) return s;
  const pours = [...s.spec.motionBeats, s.visual].some((l) => POUR.test(l));
  const fix = (b: string) => {
    if (!movesProduct(b)) return b;
    const t = b.match(TIME)?.[1];
    const what = POUR.test(b) || /\b(tilt|tip)\w*/i.test(b) ? `${LABEL_LOCK}; ${OFF_FRAME_POUR}` : LABEL_LOCK;
    return t ? `${t} ${what}` : what;
  };
  const beats = [...new Set(s.spec.motionBeats.map(fix))];
  const kept = sentences(s.visual).filter((x) => !movesProduct(x));
  const visual = [...kept, `The ${CAN.exec(s.visual)?.[1] ?? "can"} stands upright and still beside the glass, front label square to camera${pours ? `; ${OFF_FRAME_POUR}` : ""}.`].join(" ");
  const camera = pours ? "locked off, no camera move" : s.camera;
  return {
    ...s, visual, camera,
    spec: {
      ...s.spec, motionBeats: beats, cameraMove: pours ? camera : s.spec.cameraMove,
      productFraming: /always upright/i.test(s.spec.productFraming) ? s.spec.productFraming : `${lockFraming(s.spec.productFraming)}; the can is always upright, label square to camera.`,
      negative: [...new Set([...LABEL_NEGATIVE, ...s.spec.negative])].slice(0, 6),
    },
  };
}

const GLASS = /\b((?:(?:short|tall|small|large|clear|heavy|ice-filled|highball|rocks|stemless|crystal|wide|narrow)\s+){0,3})(tumbler|highball|glass|mug|cup)\b/i;

/** The first glass described in the plan (hero shot wins), used as the lock for every later shot. */
export function glassLock(shots: Pick<Shot, "spec" | "visual">[]): string | null {
  for (const s of shots) {
    const m = `${s.spec?.setting ?? ""} ${s.visual}`.match(GLASS);
    if (m) return `${m[1]}${m[2]}`.trim().toLowerCase();
  }
  return null;
}

/** Continuity locks shared by every generated shot: the same glass (size and shape) and the same label orientation. */
export function continuityLocks(shots: Shot[]): Shot[] {
  const glass = glassLock(shots.filter((s) => s.source !== "packshot"));
  const locks = [
    ...(glass ? [`Glass: the same ${glass} in every shot, identical size and shape, and the same height relative to the can as in the first shot`] : []),
    "Label: the front label stays upright and square to camera, same orientation in every shot",
  ];
  return shots.map((s) => (s.source === "packshot" || !s.spec ? s : { ...s, spec: { ...s.spec, continuity: locks } }));
}

/** Code-enforced shot-plan rules for products with labels: label lock per shot, then continuity locks across shots. */
export const enforceShotRules = (shots: Shot[]): Shot[] => continuityLocks(shots.map(applyLabelLock));
