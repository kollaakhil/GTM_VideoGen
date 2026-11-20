import { FOLEY_PATTERNS, SFX_GAIN, type SfxCue, type SfxKind } from "../sfx";

/**
 * Audio mode (PLAYBOOK 14.x): who carries the sound.
 *   vo     - a voiceover over a quiet bed, with the usual whoosh into each cut (the long-standing default);
 *   foley  - no voice: one sound effect per action written in the shot sheet, a ducked bed under them;
 *   both   - the voice plus the per-action effects, effects a little lower, the bed ducked under both.
 * Pure: it plans cues from shot rows, stitchShots mixes them, sfx.ts synthesises them locally.
 */
export type AudioMode = "vo" | "foley" | "both";
export const AUDIO_MODES: AudioMode[] = ["vo", "foley", "both"];

export interface AudioShot {
  seconds: number;
  /** What the shot shows; used when the sheet row has no sfx line. */
  visual?: string;
  /** Timed beats like "0.5–1s lid snaps shut". */
  beats?: string[];
  vo?: string | null;
  /** The sheet's sound line: actions separated by commas, "then", "and" or semicolons. */
  sfx?: string | null;
}

export interface AudioPlan {
  mode: AudioMode;
  /** Generate and mix the voiceover. */
  voice: boolean;
  sfx: SfxCue[];
  /** Sidechain-duck the bed under voice and effects. */
  duck: boolean;
  /** Bed level before ducking. */
  bedGain: number;
  /** Actions in the sheet that no recipe covers: shown to the user instead of silently dropped. */
  unmapped: string[];
  /** How many actions the sheet names and how many got an effect. */
  coverage: { actions: number; covered: number };
}

const SPLIT = /\s*(?:[,;]|\bthen\b|\band\b|\+|\/|->|→)\s*/i;
const LEAD = 0.15;
const TAIL = 0.3;

/** The kind whose cue word comes first in the phrase, so "hand taps the can, then it pops" maps tap→thud and pop→pop. */
function kindOf(phrase: string, allowed?: SfxKind[]): SfxKind | null {
  let best: { kind: SfxKind; at: number } | null = null;
  for (const { kind, re } of FOLEY_PATTERNS) {
    if (allowed && !allowed.includes(kind)) continue;
    const m = phrase.match(re);
    if (m && (!best || (m.index ?? 0) < best.at)) best = { kind, at: m.index ?? 0 };
  }
  return best?.kind ?? null;
}

const beatStart = (beats: string[] | undefined, phrase: string): number | null => {
  for (const b of beats ?? []) {
    const m = b.match(/^\s*(\d+(?:\.\d+)?)\s*(?:[–-]|s)/);
    if (m && kindOf(b) && kindOf(b) === kindOf(phrase)) return Number(m[1]);
  }
  return null;
};

export function foleyActions(s: AudioShot): string[] {
  const line = (s.sfx ?? "").trim();
  if (line) return line.split(SPLIT).map((x) => x.trim()).filter(Boolean);
  // No sound line: derive one action per distinct sound the picture implies.
  const text = `${s.visual ?? ""} ${(s.beats ?? []).join(" ")}`;
  return FOLEY_PATTERNS.filter(({ re }) => re.test(text)).map(({ kind }) => kind);
}

export function planAudio(mode: AudioMode, shots: AudioShot[]): AudioPlan {
  const cues: SfxCue[] = [];
  const unmapped: string[] = [];
  let actions = 0;
  const level = mode === "both" ? 0.7 : 1;
  for (const [i, s] of shots.entries()) {
    const list = foleyActions(s).slice(0, 5);
    const usable = Math.max(0.2, s.seconds - LEAD - TAIL);
    let placed = 0;
    for (const [j, phrase] of list.entries()) {
      const kind = kindOf(phrase);
      if (mode !== "vo") actions++;
      if (!kind) { if (mode !== "vo") unmapped.push(`shot ${i + 1}: “${phrase}”`); continue; }
      const timed = beatStart(s.beats, phrase);
      const offset = Math.min(Math.max(LEAD, timed ?? LEAD + (list.length > 1 ? (usable * j) / list.length : 0.15)), Math.max(LEAD, s.seconds - TAIL));
      // One sound per kind per 0.4 s: two phrases that map to the same effect at the same moment are one sound.
      if (cues.some((c) => c.shot === i && c.kind === kind && Math.abs(c.offset - offset) < 0.4)) { if (mode !== "vo") actions--; continue; }
      cues.push({ kind, shot: i, offset: Number(offset.toFixed(2)), gain: Number((SFX_GAIN[kind] * level).toFixed(3)) });
      placed++;
    }
    void placed;
  }
  const covered = cues.length;
  return {
    mode,
    voice: mode !== "foley",
    sfx: cues,
    duck: mode !== "vo",
    bedGain: mode === "vo" ? 0.18 : mode === "foley" ? 0.42 : 0.3,
    unmapped,
    coverage: { actions: mode === "vo" ? covered : actions, covered },
  };
}
