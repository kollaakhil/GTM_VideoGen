import { execFile } from "node:child_process";
import { toolPath } from "./local-tools";

/**
 * Beat-synced editing. The music bed is analysed locally (librosa beat_track + onset_detect in the ~/.gtm-tools venv,
 * free), and each cut moves to the nearest beat within a small window, so cuts land on the music instead of
 * wherever the script's beat lengths happen to fall. Shots only lengthen into clip slack they really have, and the
 * shift is capped so pacing vs the approved script stays within the edit gate's 0.25 s tolerance.
 */
export type Beats = { tempo: number; beats: number[]; onsets: number[] };

const PY = `
import json, sys, warnings
warnings.filterwarnings("ignore")
import librosa
y, sr = librosa.load(sys.argv[1], sr=22050, mono=True)
tempo, frames = librosa.beat.beat_track(y=y, sr=sr)
on = librosa.onset.onset_detect(y=y, sr=sr, units="time", backtrack=False)
t = float(tempo[0] if hasattr(tempo, "__len__") else tempo)
print(json.dumps({"tempo": t, "beats": [round(float(x), 3) for x in librosa.frames_to_time(frames, sr=sr)], "onsets": [round(float(x), 3) for x in on]}))
`;

export function detectBeats(file: string): Promise<Beats | null> {
  return new Promise((resolve) => {
    execFile(toolPath.python(), ["-c", PY, file], { timeout: 90_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        const b = JSON.parse(stdout.trim().split("\n").pop()!) as Beats;
        resolve(b.beats?.length ? b : null);
      } catch {
        resolve(null);
      }
    });
  });
}

export const SNAP = { later: 0.25, earlier: 0.25, minShot: 1.2 };

/**
 * New shot lengths with each internal cut moved to the nearest beat (or onset) in [cut − earlier, cut + later].
 * `available[i]` is how long clip i really is; a shot never grows past it. The last shot keeps its length.
 */
export function snapCuts(seconds: number[], beats: number[], available: number[] = seconds, o = SNAP): { seconds: number[]; snapped: number; shifts: number[] } {
  const out = [...seconds];
  const shifts: number[] = [];
  let snapped = 0, start = 0;
  for (let i = 0; i < seconds.length - 1; i++) {
    const cut = start + out[i];
    const lo = Math.max(start + o.minShot, cut - o.earlier), hi = Math.min(start + (available[i] ?? out[i]) - 0.04, cut + o.later);
    const near = beats.filter((b) => b >= lo && b <= hi).sort((a, b) => Math.abs(a - cut) - Math.abs(b - cut))[0];
    const shift = near === undefined ? 0 : Number((near - cut).toFixed(3));
    if (near !== undefined) snapped++;
    out[i] = Number((out[i] + shift).toFixed(3));
    shifts.push(shift);
    start += out[i];
  }
  return { seconds: out, snapped, shifts };
}

/** Share of internal cuts within `tol` s of a beat (for the edit gate). */
export function onBeatShare(cuts: number[], beats: number[], tol = 0.08) {
  if (!cuts.length || !beats.length) return null;
  return cuts.filter((c) => beats.some((b) => Math.abs(b - c) <= tol)).length / cuts.length;
}
