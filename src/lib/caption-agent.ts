/**
 * Caption mode, keyword captions and the caption-placement agent (Akhil t56u, playbook 13.31).
 *
 * - "off": voiceover only; no in-shot captions or overlays (the end card still carries brand, offer and CTA).
 * - "keywords": one 2-4 word phrase per line (the strongest contiguous run: numbers, brand, content words), shown
 *   from when its first word is said to the end of the line, and kept off the subject.
 * - "full": the previous behaviour (4-word chunks of the whole line).
 *
 * The placement agent runs before export. For every caption cue it walks the sampled frames inside the cue and checks
 * the caption box against that frame's subject box (product plus the hand or person using it, located by the vision
 * model on the stitched video: `locateSubjects` in video-plan.ts) and every overlay on screen at the same time. Edge
 * energy was tried first and rejected: on the dinner-table shots it boxed 70-80% of the frame and dropped every cue. A colliding cue is moved to another slot, then shrunk (fewer words), then dropped, and each action is logged.
 */
import { type Box, CAPTION_SLOTS, inSafe, overlaps } from "./caption-layout";

export type CaptionMode = "off" | "keywords" | "full";
export const DEFAULT_CAPTION_MODE: CaptionMode = "keywords";
export const captionMode = (m?: string | null): CaptionMode => (m === "off" || m === "full" || m === "keywords" ? m : DEFAULT_CAPTION_MODE);

const STOP = new Set(("a an the and or but so of to in on at for with by from as is are was were be been it its this that these those " +
  "your you our we my me i he she they them their his her just very really more most than then there here what who how " +
  "do does did not no yes if into onto over under up down out off about").split(" "));
const word = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}+%$.]/gu, "").replace(/\.$/, "");
const isStop = (w: string) => STOP.has(word(w));
const strong = (w: string, brand?: string) => /\d|%|\$|\+|\.(com|co|io|shop)\b/i.test(w) || /^(one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|hundred|half|free|plus)(-|$)/i.test(word(w)) || (!!brand && word(w).includes(brand.toLowerCase()));

/** Contiguous `n`-word windows of a line, strongest first (content words, numbers/brand; no function-word edges). */
export function keywordWindows(line: string, n: number, brand?: string): { text: string; from: number; score: number }[] {
  const ws = line.trim().split(/\s+/).filter(Boolean);
  const out: { text: string; from: number; score: number }[] = [];
  for (let i = 0; i + n <= ws.length; i++) {
    const win = ws.slice(i, i + n);
    // A phrase that crosses a comma or sentence end reads as two fragments ("Love cola, dread").
    if (win.slice(0, -1).some((w) => /[,;:.?!]$/.test(w) && !/\.(com|co|io|shop)\.?$/i.test(w))) continue;
    const content = win.filter((w) => !isStop(w)).length;
    const bonus = win.filter((w) => strong(w, brand)).length * 2;
    const edges = (isStop(win[0]) ? 1.5 : 0) + (isStop(win[n - 1]) ? 2 : 0);
    out.push({ text: tidy(win.join(" ")), from: i, score: content + bonus - edges - n * 0.25 });
  }
  return out.sort((a, b) => b.score - a.score || a.from - b.from);
}

/** The strongest contiguous 2-4 word phrase of a line, punctuation trimmed at its edges. */
export function keywordPhrase(line: string, brand?: string, maxWords = 4): { text: string; from: number; words: number } {
  const ws = line.trim().split(/\s+/).filter(Boolean);
  if (ws.length <= 2) return { text: tidy(ws.join(" ")), from: 0, words: ws.length };
  let best: { text: string; from: number; score: number } | null = null;
  for (let n = 2; n <= Math.min(maxWords, ws.length); n++) for (const w of keywordWindows(line, n, brand)) if (!best || w.score > best.score + 1e-9) best = w;
  return { text: best!.text, from: best!.from, words: ws.length };
}
const exactish = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const tidy = (t: string) => t.replace(/^[^\p{L}\p{N}$]+/u, "").replace(/[,;:!?]+$/u, "").replace(/\.$/, "");

/** Keyword cue timing: from when the phrase's first word is said (linear in word position) to the end of the line. */
export function keywordCues(segments: { start: number; end: number; text: string; onScreen?: string; speech?: { start: number; end: number } }[], brand?: string) {
  return segments.flatMap((s) => {
    if (!s.text.trim()) return [];
    // A shot whose approved on-screen copy repeats its line (the CTA) shows that copy, not a keyword pick: its overlay
    // is suppressed as a duplicate, so this cue is the shot's only required text (take 7: "approved CTA missing").
    const own = s.onScreen?.trim();
    if (own && own.split(/\s+/).length <= 6 && exactish(s.text).includes(exactish(own))) {
      return [{ start: s.speech ? Math.max(s.start, s.speech.start - 0.15) : s.start, end: s.end, text: own }];
    }
    const a = s.speech ? Math.max(s.start, s.speech.start) : s.start;
    const b = s.speech ? Math.min(s.end, Math.max(a + 0.3, s.speech.end)) : s.end;
    const k = keywordPhrase(s.text, brand);
    const at = a + ((b - a) * k.from) / Math.max(1, k.words);
    const start = Math.max(s.start, Math.min(at - 0.15, b - 1.2));
    return [{ start, end: Math.min(s.end, Math.max(b, start + 1.2)), text: k.text }];
  });
}

/** A subject box from source-video fractions to an export frame made by `crop` (centred) or `pad` (fit + letterbox). */
export function mapSubject(b: Box, src: { w: number; h: number }, out: { w: number; h: number }, how: "crop" | "pad"): Box {
  const s = how === "pad" ? Math.min(out.w / src.w, out.h / src.h) : 1;
  const ox = (out.w - src.w * s) / 2, oy = (out.h - src.h * s) / 2;
  return { x: (b.x * src.w * s + ox) / out.w, y: (b.y * src.h * s + oy) / out.h, w: (b.w * src.w * s) / out.w, h: (b.h * src.h * s) / out.h };
}

const area = (b: Box) => Math.max(0, b.w) * Math.max(0, b.h);
const inter = (a: Box, b: Box) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};
const grow = (b: Box, m: number): Box => ({ x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m });
/** A caption may graze the subject's edge; more than this share of the caption box over the subject is a collision. */
export const SUBJECT_OVERLAP_MAX = 0.2;

export type PlacedCaption = { start: number; end: number; text: string; y: number; box: Box };
export type AgentAction = { text: string; start: number; action: "kept" | "moved" | "shrunk" | "dropped"; from?: number; to?: number; to_text?: string; reason?: string };

/** Collision reason for `box` during [start, end), or null when it is clear in every sampled frame. */
export function collision(box: Box, start: number, end: number, subjects: { t: number; box: Box | null }[], overlays: { start: number; end: number; box: Box }[]): string | null {
  for (const o of overlays) if (o.start < end && start < o.end && overlaps(grow(o.box, 0.01), box)) return "overlaps an overlay";
  for (const s of subjects) {
    // Only frames while the cue is up: a ±0.25 s slack let the previous shot's subject drop the packshot CTA (take 7).
    if (s.t < start - 0.05 || s.t > end + 0.05 || !s.box) continue;
    if (inter(box, s.box) / area(box) > SUBJECT_OVERLAP_MAX) return `covers the subject at ${s.t.toFixed(1)}s`;
  }
  return null;
}

/**
 * The placement agent. `boxFor(text, y)` gives the caption box for a text at slot `y`. Tries the current slot, the
 * other slots (nearest first), then shorter phrases (down to 2 words) in every slot, then drops the cue.
 */
export function placeCaptions(
  captions: PlacedCaption[], overlays: { start: number; end: number; box: Box }[], subjects: { t: number; box: Box | null }[],
  boxFor: (text: string, y: number) => Box, slots: readonly number[] = CAPTION_SLOTS,
): { captions: PlacedCaption[]; log: AgentAction[] } {
  const out: PlacedCaption[] = [], log: AgentAction[] = [];
  for (const c of captions) {
    const order = [c.y, ...[...slots].filter((y) => y !== c.y).sort((p, q) => Math.abs(p - c.y) - Math.abs(q - c.y))];
    // Shrinking = a shorter phrase from the same cue (fewer words, narrower box), strongest windows first.
    const ws = c.text.split(/\s+/);
    const texts = [c.text];
    for (let n = ws.length - 1; n >= 2; n--) for (const w of keywordWindows(c.text, n)) if (w.score > 0 && !texts.includes(w.text)) texts.push(w.text);
    let done = false, first: string | null = null;
    for (const [ti, text] of texts.entries()) {
      for (const y of order) {
        const box = boxFor(text, y);
        if (!inSafe(box)) continue;
        const why = collision(box, c.start, c.end, subjects, [...overlays, ...out]);
        if (!why) {
          out.push({ ...c, text, y, box });
          log.push(ti ? { text: c.text, start: c.start, action: "shrunk", from: c.y, to: y, to_text: text, reason: first ?? undefined } : y === c.y ? { text: c.text, start: c.start, action: "kept" } : { text: c.text, start: c.start, action: "moved", from: c.y, to: y, reason: first ?? undefined });
          done = true;
          break;
        }
        first ??= why;
      }
      if (done) break;
    }
    if (!done) log.push({ text: c.text, start: c.start, action: "dropped", reason: first ?? "no safe slot" });
  }
  return { captions: out, log };
}
