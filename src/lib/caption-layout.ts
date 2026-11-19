import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { exactCopy } from "./script-lab";

const run = promisify(execFile);
const FFMPEG = ffmpegPath || "ffmpeg";

/**
 * Caption placement that keeps text off the product and subject.
 *
 * The busiest part of a frame (edges: label print, hands, glass rims, faces in focus) is where the subject is; soft
 * bokeh, plain walls and table tops are quiet. For every shot we measure edge energy where each candidate caption box
 * would sit, over the frames the line is on screen, and pick the quietest slot inside the platform safe zone
 * (top 8%, bottom 20% are covered by Reels/TikTok UI). Captions and the shot's overlay never share a slot.
 */

/** Edge energy (0…255) on a coarse grid, one frame every 1/fps seconds. */
export type EnergyMap = { gw: number; gh: number; fps: number; frames: Uint8Array[] };
export type Box = { x: number; y: number; w: number; h: number }; // fractions of the frame
export type Placement = { y: number; box: Box };

export const SAFE_TOP = 0.08;
export const SAFE_BOTTOM = 0.8;
/** Candidate centre lines (fraction of frame height), default first. */
export const CAPTION_SLOTS = [0.74, 0.66, 0.56, 0.36, 0.26, 0.17] as const;
export const OVERLAY_SLOTS = [0.17, 0.26, 0.36, 0.56, 0.66, 0.74] as const;
/** Keep the default slot unless another is clearly quieter (avoids captions jumping on near-ties). */
const STICKY = 0.85;

/** Rough rendered size of a line of bold sans at `size` px wrapped into `maxW` px. */
export function textBox(text: string, size: number, w: number, h: number, maxFrac = 0.84, pad = 0.28): { bw: number; bh: number } {
  const chars = text.replace(/\s+/g, " ").trim().length || 1;
  const maxW = w * maxFrac;
  const raw = chars * size * 0.58;
  const lines = Math.max(1, Math.ceil(raw / maxW));
  const bw = Math.min(maxW, raw) + 2 * size * pad;
  const bh = lines * size * 1.22 + 2 * size * pad;
  return { bw: bw / w, bh: bh / h };
}

const boxAt = (y: number, size: { bw: number; bh: number }): Box => ({ x: 0.5 - size.bw / 2, y: y - size.bh / 2, w: size.bw, h: size.bh });
const inSafe = (b: Box) => b.y >= SAFE_TOP - 1e-6 && b.y + b.h <= SAFE_BOTTOM + 1e-6;
export const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Mean edge energy inside `box` over frames in [start, end). */
export function boxEnergy(map: EnergyMap, box: Box, start: number, end: number) {
  const x0 = Math.max(0, Math.floor(box.x * map.gw)), x1 = Math.min(map.gw, Math.ceil((box.x + box.w) * map.gw));
  const y0 = Math.max(0, Math.floor(box.y * map.gh)), y1 = Math.min(map.gh, Math.ceil((box.y + box.h) * map.gh));
  let sum = 0, n = 0;
  map.frames.forEach((f, i) => {
    const t = (i + 0.5) / map.fps;
    if (t < start - 0.25 || t > end + 0.25) return;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { sum += f[y * map.gw + x]; n++; }
  });
  return n ? sum / n : 0;
}

/** Quietest slot for `size` during [start, end) that doesn't collide with `avoid`; default slot wins near-ties. */
export function pickSlot(map: EnergyMap | null, slots: readonly number[], size: { bw: number; bh: number }, start: number, end: number, avoid: Box[] = []): Placement {
  const options = slots.map((y) => ({ y, box: boxAt(y, size) })).filter((o) => inSafe(o.box) && !avoid.some((a) => overlaps(a, o.box)));
  const pool = options.length ? options : slots.map((y) => ({ y, box: boxAt(y, size) })).filter((o) => !avoid.some((a) => overlaps(a, o.box)));
  const list = pool.length ? pool : [{ y: slots[0], box: boxAt(slots[0], size) }];
  if (!map) return list[0];
  const scored = list.map((o) => ({ ...o, cost: boxEnergy(map, o.box, start, end) }));
  const best = scored.reduce((a, b) => (b.cost < a.cost ? b : a));
  const first = scored[0];
  return first.cost * STICKY <= best.cost ? first : best;
}

/** True when the overlay just repeats the spoken caption (e.g. the CTA shown twice); the caption alone is enough. */
export function duplicateOverlay(onScreen: string, vo: string) {
  const a = exactCopy(onScreen), b = exactCopy(vo);
  return !!a && !!b && (a === b || b.includes(a) || a.includes(b));
}

export type Segment = { start: number; end: number; text: string; onScreen?: string; speech?: { start: number; end: number } };

/** The overlays that are actually drawn: one per shot with on-screen copy, minus copies of its own voice line. */
export function shotOverlays(segments: Segment[]) {
  return segments.flatMap((s) => s.onScreen?.trim() && !duplicateOverlay(s.onScreen, s.text) ? [{ start: s.start, end: s.end, text: s.onScreen.trim() }] : []);
}

/**
 * Places every overlay and caption cue. Overlays go first (they span the shot), then all caption cues of that shot
 * share one slot that avoids the overlay, so captions don't hop around within a shot.
 */
export function layoutCopy(
  map: EnergyMap | null, w: number, h: number,
  segments: Segment[], cues: { start: number; end: number; text: string }[],
  sizes: { caption: number; overlay: number },
) {
  const overlays = shotOverlays(segments).map((o) => ({ ...o, ...pickSlot(map, OVERLAY_SLOTS, textBox(o.text, sizes.overlay, w, h, 0.76), o.start, o.end) }));
  const windows = segments.length ? segments : [{ start: 0, end: Infinity, text: "" }];
  const captions = cues.map((c) => ({ ...c, y: CAPTION_SLOTS[0] as number, box: boxAt(CAPTION_SLOTS[0], textBox(c.text, sizes.caption, w, h)) }));
  for (const seg of windows) {
    const mine = captions.filter((c) => c.start >= seg.start - 1e-3 && c.start < seg.end - 1e-3);
    if (!mine.length) continue;
    const widest = mine.reduce((a, b) => (b.box.w * b.box.h > a.box.w * a.box.h ? b : a));
    const live = overlays.filter((o) => o.start < seg.end && seg.start < o.end);
    const avoid = live.map((o) => o.box);
    // One text group: with an overlay up top, try the slots just under it first instead of the lower third, where the
    // product sits ("consolidate top and bottom overlays", "captions obstruct the can", take 2 judges; 13.25).
    const top = live.find((o) => o.y <= 0.3);
    const slots = top ? [...CAPTION_SLOTS].sort((p1, p2) => Math.abs(p1 - top.y - 0.1) - Math.abs(p2 - top.y - 0.1)) : CAPTION_SLOTS;
    const p = pickSlot(map, slots, { bw: widest.box.w, bh: widest.box.h }, seg.start, Math.min(seg.end, Math.max(...mine.map((c) => c.end))), avoid);
    for (const c of mine) { c.y = p.y; c.box = boxAt(p.y, { bw: c.box.w, bh: c.box.h }); }
  }
  return { overlays, captions };
}

/** Edge-energy map of `file` after the aspect's crop/pad (`spatial`), `fps` frames per second. */
export async function energyMap(file: string, spatial: string, w: number, h: number, fps = 2): Promise<EnergyMap | null> {
  const gw = 36, gh = Math.max(8, Math.round((36 * h) / w));
  try {
    const { stdout } = await run(FFMPEG, ["-v", "error", "-i", file, "-an", "-vf",
      `${spatial},fps=${fps},scale=${gw * 4}:${gh * 4},format=gray,edgedetect=low=0.08:high=0.22,scale=${gw}:${gh}:flags=area`,
      "-f", "rawvideo", "-pix_fmt", "gray", "-"], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
    const size = gw * gh;
    const frames: Uint8Array[] = [];
    for (let o = 0; o + size <= stdout.length; o += size) frames.push(new Uint8Array(stdout.subarray(o, o + size)));
    return frames.length ? { gw, gh, fps, frames } : null;
  } catch {
    return null; // fall back to the default slots
  }
}
