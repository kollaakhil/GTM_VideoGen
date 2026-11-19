import type { ShotSheet, SheetShot } from "@/lib/shot-sheet";

const r3 = (x: number) => Math.round(x * 1000) / 1000;
/** Shots shorter than this read as a flash frame; the gate rejects them and fitTimings never makes them. */
export const MIN_SHOT = 0.6;
export const MAX_SHOT = 8;

/**
 * Re-times shots so they run back to back from 0 and end exactly on `target`, keeping each shot's share of the
 * runtime. Used after the enhancer (models are sloppy with sums) and after operator edits to one row's length.
 */
export function fitTimings<T extends Pick<SheetShot, "start" | "end">>(shots: T[], target: number): T[] {
  if (!shots.length) return shots;
  const raw = shots.map((s) => Math.max(0.01, s.end - s.start));
  const fixed = new Set<number>();
  let lens = raw.slice();
  // Proportional fit; any shot that would fall under the floor is pinned at the floor and the rest share what's left.
  for (let guard = 0; guard <= shots.length; guard++) {
    const room = target - fixed.size * MIN_SHOT;
    const free = raw.reduce((a, d, i) => (fixed.has(i) ? a : a + d), 0);
    lens = raw.map((d, i) => (fixed.has(i) ? MIN_SHOT : (d / free) * room));
    const low = lens.findIndex((d, i) => !fixed.has(i) && d < MIN_SHOT);
    if (low < 0) break;
    fixed.add(low);
  }
  let t = 0;
  return shots.map((s, i) => {
    const start = r3(t);
    t += lens[i];
    const end = i === shots.length - 1 ? r3(target) : r3(t);
    return { ...s, start, end };
  });
}

/** Problems with the sheet's clock: gaps, overlaps, out-of-range shots and a total that misses the target. */
export function timingIssues(sheet: Pick<ShotSheet, "shots" | "targetSec">): string[] {
  const out: string[] = [];
  const s = sheet.shots;
  if (!s.length) return ["The sheet has no shots."];
  if (Math.abs(s[0].start) > 0.01) out.push(`Shot 1 starts at ${s[0].start}s, not 0s.`);
  for (let i = 0; i < s.length; i++) {
    const d = s[i].end - s[i].start;
    if (d < MIN_SHOT - 1e-6) out.push(`Shot ${i + 1} is ${d.toFixed(2)}s; the minimum is ${MIN_SHOT}s.`);
    if (d > MAX_SHOT + 1e-6) out.push(`Shot ${i + 1} is ${d.toFixed(2)}s; the maximum is ${MAX_SHOT}s.`);
    if (i > 0 && Math.abs(s[i].start - s[i - 1].end) > 0.01) out.push(`Shot ${i + 1} starts at ${s[i].start}s but shot ${i} ends at ${s[i - 1].end}s.`);
  }
  const last = s[s.length - 1].end;
  if (Math.abs(last - sheet.targetSec) > 0.05) out.push(`The shots end at ${last}s; the target is ${sheet.targetSec}s.`);
  return out;
}

/** "00:03.40" for the shot sheet table and the editor instructions. */
export const tc = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
};

/** Changing one shot's length: the following shots slide, and the whole sheet is refit to the target. */
export function setShotLength(sheet: ShotSheet, index: number, seconds: number): ShotSheet {
  const shots = sheet.shots.map((s) => ({ ...s }));
  const lens = shots.map((s) => s.end - s.start);
  lens[index] = Math.max(MIN_SHOT, Math.min(MAX_SHOT, seconds));
  const others = lens.reduce((a, b, i) => (i === index ? a : a + b), 0);
  const room = Math.max(MIN_SHOT * (shots.length - 1), sheet.targetSec - lens[index]);
  let t = 0;
  for (let i = 0; i < shots.length; i++) {
    const d = i === index ? lens[i] : (lens[i] / (others || 1)) * room;
    shots[i].start = r3(t);
    t += d;
    shots[i].end = r3(t);
  }
  return { ...sheet, shots: fitTimings(shots, sheet.targetSec) };
}
