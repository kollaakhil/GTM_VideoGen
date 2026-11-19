import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import type { Shot } from "./types";

const run = promisify(execFile);

/**
 * Foley synthesised locally with FFmpeg's lavfi generators. Every sound is generated from noise and sine sources
 * by this code, so there are no samples, no third-party recordings and no licence to track: the output is original
 * work created by the app (see PLAYBOOK 13.11). They are cheap stand-ins for a recorded library; swap in a licensed
 * CC0 pack via SFX_DIR (files named <kind>.wav) if one is added later.
 */
export type SfxKind = "whoosh" | "pop" | "fizz" | "pour" | "clink" | "click" | "thud" | "slide" | "sizzle";

const RECIPES: Record<SfxKind, { d: number; graph: string }> = {
  // Air swish across a cut: pink noise through a band that swells and fades.
  whoosh: { d: 0.45, graph: "anoisesrc=d=0.45:c=pink:a=0.6:r=44100,highpass=f=500,lowpass=f=3500,afade=t=in:d=0.2,afade=t=out:st=0.2:d=0.25" },
  // Can crack: a sharp transient then a short hiss of escaping gas.
  pop: { d: 0.5, graph: "aevalsrc='(random(0)*2-1)*exp(-70*t)+0.35*(random(1)*2-1)*exp(-9*t)*gt(t,0.012)':d=0.5:s=44100,highpass=f=900" },
  // Carbonation: bright crackle with random amplitude flutter.
  fizz: { d: 1.6, graph: "anoisesrc=d=1.6:c=white:a=0.5:r=44100,highpass=f=4500,tremolo=f=27:d=0.7,afade=t=in:d=0.15,afade=t=out:st=0.9:d=0.7" },
  // Pour: low gurgle, brown noise band with a slow wobble.
  pour: { d: 1.8, graph: "anoisesrc=d=1.8:c=brown:a=0.8:r=44100,bandpass=f=650:width_type=h:w=500,tremolo=f=6:d=0.5,afade=t=in:d=0.2,afade=t=out:st=1.3:d=0.5" },
  // Ice clink: two inharmonic partials with a fast decay.
  clink: { d: 0.6, graph: "aevalsrc='0.6*sin(2*PI*2380*t)*exp(-14*t)+0.4*sin(2*PI*3710*t)*exp(-18*t)':d=0.6:s=44100" },
  // Switch or button: two short ticks, the second lower.
  click: { d: 0.25, graph: "aevalsrc='0.8*sin(2*PI*3100*t)*exp(-220*t)+0.6*sin(2*PI*1500*t)*exp(-260*(t-0.07))*gt(t,0.07)':d=0.25:s=44100,highpass=f=800" },
  // Something set down or struck: a low body thump with a little knock on top.
  thud: { d: 0.5, graph: "aevalsrc='sin(2*PI*(70+40*exp(-30*t))*t)*exp(-14*t)+0.25*(random(2)*2-1)*exp(-80*t)':d=0.5:s=44100,lowpass=f=900" },
  // A slow drag across a surface (light sweep, sliding part): filtered noise with a rising then falling band.
  slide: { d: 0.9, graph: "anoisesrc=d=0.9:c=pink:a=0.45:r=44100,bandpass=f=1800:width_type=h:w=1400,tremolo=f=9:d=0.35,afade=t=in:d=0.3,afade=t=out:st=0.5:d=0.4" },
  // Heat or fizzing metal: a dense high crackle that decays.
  sizzle: { d: 1.4, graph: "anoisesrc=d=1.4:c=white:a=0.5:r=44100,highpass=f=3000,tremolo=f=45:d=0.9,afade=t=in:d=0.1,afade=t=out:st=0.7:d=0.7" },
};

export const SFX_GAIN: Record<SfxKind, number> = { whoosh: 0.12, pop: 0.45, fizz: 0.18, pour: 0.3, clink: 0.22, click: 0.4, thud: 0.5, slide: 0.3, sizzle: 0.2 };

export async function sfxFile(kind: SfxKind, dir: string): Promise<string> {
  const out = path.join(dir, `sfx-${kind}.wav`);
  await run(ffmpegPath || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", RECIPES[kind].graph, "-ac", "2", "-ar", "44100", "-t", String(RECIPES[kind].d), "-y", out], { timeout: 30_000 });
  return out;
}

export type SfxCue = { kind: SfxKind; shot: number; offset: number; gain: number };

const CUES: { kind: SfxKind; re: RegExp }[] = [
  { kind: "pop", re: /\b(crack|cracks|cracking|pop|pops|popping|open(s|ing)? the can|tab)\b/i },
  { kind: "pour", re: /\b(pour|pours|pouring|stream|streams)\b/i },
  { kind: "fizz", re: /\b(fizz|fizzing|fizzes|bubbl\w*|carbonat\w*|foam\w*|sparkl\w*)\b/i },
  { kind: "clink", re: /\b(ice|clink\w*|glass(es)? (touch|meet))\b/i },
];

/** Extra action sounds used only by the foley-first mode (audio/mode.ts), so the default per-shot cues stay as they were. */
const EXTRA: { kind: SfxKind; re: RegExp }[] = [
  { kind: "click", re: /\b(click\w*|switch\w*|snap\w*|button|latch\w*|dial|toggle|flick\w*)\b/i },
  { kind: "thud", re: /\b(thud|lands?|set(s)? down|placed?|drops?|impact|slam\w*|hits?|knock\w*|tap\w*)\b/i },
  { kind: "slide", re: /\b(slides?|sliding|glides?|sweeps?|drag\w*|rotat\w*|spins?|turns?)\b/i },
  { kind: "sizzle", re: /\b(sizzl\w*|crackl\w*|spark\w*|sear\w*|burn\w*|ignit\w*)\b/i },
];

export const FOLEY_PATTERNS = [...CUES, ...EXTRA];

/** Start second of the motion beat that mentions the action ("1–3s cola streams…" → 1), else a default lead-in. */
function beatTime(s: Shot, re: RegExp, fallback: number) {
  for (const b of s.spec?.motionBeats ?? []) {
    if (!re.test(b)) continue;
    const m = b.match(/^\s*(\d+(?:\.\d+)?)\s*(?:[–-]|s)/);
    if (m) return Math.min(Number(m[1]), Math.max(0, s.seconds - 0.4));
  }
  return fallback;
}

/**
 * SFX per shot from what the shot shows: at most one of each kind per shot, timed to its motion beat, plus a soft
 * whoosh into every cut. Fizz follows a pour when both appear.
 */
export function sfxCues(shots: Shot[]): SfxCue[] {
  const cues: SfxCue[] = [];
  for (const [i, s] of shots.entries()) {
    const text = `${s.expectedVisual ?? ""} ${s.visual} ${(s.spec?.motionBeats ?? []).join(" ")}`;
    for (const { kind, re } of CUES) {
      if (!re.test(text)) continue;
      const def = kind === "pop" ? 0.3 : kind === "pour" ? 0.6 : kind === "fizz" ? 1.2 : 0.5;
      let offset = beatTime(s, re, def);
      if (kind === "fizz" && cues.some((c) => c.shot === i && c.kind === "pour")) offset = Math.max(offset, cues.find((c) => c.shot === i && c.kind === "pour")!.offset + 0.8);
      if (offset < s.seconds - 0.2) cues.push({ kind, shot: i, offset: Number(offset.toFixed(2)), gain: SFX_GAIN[kind] });
    }
    if (i > 0) cues.push({ kind: "whoosh", shot: i, offset: -0.22, gain: SFX_GAIN.whoosh });
  }
  return cues;
}
