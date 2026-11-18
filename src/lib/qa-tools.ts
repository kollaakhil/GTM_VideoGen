import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { hasFile, hasPython, run, toolPath, withTemp, writeDataUrl } from "./local-tools";

/**
 * Frame-by-frame and word-by-word QA with free local tools. Every tool is optional: when one is missing the
 * check falls back to a built-in method (and says so in `via`) instead of failing the export.
 */
const FFMPEG = ffmpegPath || "ffmpeg";

export type Word = { word: string; start: number; end: number };

/** Lowercased words with punctuation stripped, numbers kept: the normalisation jiwer's default transform uses. */
export function normWords(text: string) {
  return text.toLowerCase().replace(/[’']/g, "").match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Word error rate: (substitutions + deletions + insertions) / reference words. */
export function wordErrorRate(reference: string, hypothesis: string) {
  const r = normWords(reference);
  const h = normWords(hypothesis);
  if (!r.length) return h.length ? 1 : 0;
  let prev = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i++) {
    const cur = [i];
    for (let j = 1; j <= h.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[h.length] / r.length;
}

/** WER through jiwer when the tools venv has it (the reference implementation), else the built-in version. */
export async function werCheck(reference: string, hypothesis: string): Promise<{ wer: number; via: "jiwer" | "builtin" }> {
  if (await hasPython("jiwer")) {
    try {
      const code = "import sys,json,jiwer,re\nd=json.load(sys.stdin)\nn=lambda s:' '.join(re.findall(r'\\w+',s.lower().replace(\"'\",'').replace('\u2019','')))\nr=n(d['r']);h=n(d['h'])\nprint(jiwer.wer(r,h) if r else (1.0 if h else 0.0))";
      const out = await new Promise<string>((resolve, reject) => {
        const p = execFile(toolPath.python(), ["-c", code], { timeout: 60_000 }, (err, stdout) => err ? reject(err) : resolve(stdout));
        p.stdin?.on("error", () => {});
        p.stdin?.end(JSON.stringify({ r: reference, h: hypothesis }));
      });
      const wer = Number(out.trim());
      if (Number.isFinite(wer)) return { wer, via: "jiwer" };
    } catch { /* fall through */ }
  }
  return { wer: wordErrorRate(reference, hypothesis), via: "builtin" };
}

/**
 * Word timestamps for the whole mix. WhisperX (WHISPERX=1; forced alignment, downloads its model once) is the most
 * precise; whisper.cpp with one word per segment is the fast local default.
 */
export async function wordTimings(media: string): Promise<{ words: Word[]; via: "whisperx" | "whisper.cpp" } | null> {
  return withTemp("gtm-words-", async (dir) => {
    const src = await writeDataUrl(path.join(dir, "in.mp4"), media);
    const wav = path.join(dir, "a.wav");
    await run(FFMPEG, ["-v", "error", "-i", src, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-y", wav], { timeout: 60_000 });
    if (process.env.WHISPERX === "1" && await hasPython("whisperx")) {
      try {
        await run(toolPath.python(), ["-m", "whisperx", wav, "--model", process.env.WHISPERX_MODEL || "base.en", "--language", "en", "--compute_type", "int8", "--device", "cpu", "--output_format", "json", "--output_dir", dir], { timeout: 600_000, maxBuffer: 16 * 1024 * 1024 });
        const json = JSON.parse(await fs.readFile(path.join(dir, "a.json"), "utf8")) as { segments: { words?: { word: string; start?: number; end?: number }[] }[] };
        const words = json.segments.flatMap((s) => s.words ?? []).filter((w) => w.start !== undefined).map((w) => ({ word: w.word.trim(), start: w.start!, end: w.end ?? w.start! }));
        if (words.length) return { words, via: "whisperx" as const };
      } catch { /* fall back to whisper.cpp */ }
    }
    const model = process.env.WHISPER_MODEL_PATH?.replace(/^~(?=\/)/, process.env.HOME ?? "~");
    if (!model || !await hasFile(model)) return null;
    try {
      await new Promise<void>((resolve, reject) => {
        const p = execFile(process.env.WHISPER_BIN || "whisper-cli", ["-m", model, "-f", wav, "-l", process.env.WHISPER_LANG || "en", "-ml", "1", "-sow", "-oj", "-np", "-of", path.join(dir, "w")], { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }, (err) => err ? reject(err) : resolve());
        p.stdin?.end();
      });
      const json = JSON.parse(await fs.readFile(path.join(dir, "w.json"), "utf8")) as { transcription: { offsets: { from: number; to: number }; text: string }[] };
      const words = json.transcription.filter((t) => t.text.trim()).map((t) => ({ word: t.text.trim(), start: t.offsets.from / 1000, end: t.offsets.to / 1000 }));
      return { words, via: "whisper.cpp" as const };
    } catch {
      return null;
    }
  });
}

/** Hard cuts inside a clip (seconds). PySceneDetect's adaptive detector when installed, else FFmpeg's scdet. */
export async function sceneCuts(media: string): Promise<{ cuts: number[]; via: "scenedetect" | "ffmpeg" }> {
  return withTemp("gtm-scenes-", async (dir) => {
    const src = await writeDataUrl(path.join(dir, "in.mp4"), media);
    if (await hasPython("scenedetect")) {
      try {
        const { stdout, stderr } = await run(toolPath.python(), ["-m", "scenedetect", "-i", src, "detect-adaptive", "list-scenes", "-n"], { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 });
        const log = stdout + stderr;
        if (!/Detected \d+ scenes?/.test(log)) throw new Error("unexpected scenedetect output");
        return { cuts: parseSceneList(log), via: "scenedetect" as const };
      } catch { /* fall back */ }
    }
    const { stderr } = await run(FFMPEG, ["-hide_banner", "-nostats", "-i", src, "-an", "-vf", "scale=240:-2,scdet=t=14", "-f", "null", "-"], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    return { cuts: [...stderr.matchAll(/lavfi\.scd\.time:\s*([\d.]+)/g)].map((m) => Number(m[1])), via: "ffmpeg" as const };
  });
}

/**
 * Lip-sync confidence for on-camera speech (SyncNet). Only meaningful when a person speaks to camera with the
 * clip's own audio, so it runs only when LIPSYNC_QA=1. Returns null when unavailable.
 */
export async function lipSync(media: string): Promise<{ offset: number; confidence: number } | null> {
  if (process.env.LIPSYNC_QA !== "1") return null;
  const dir = toolPath.syncnet();
  if (!await hasFile(path.join(dir, "data", "syncnet_v2.model")) || !await hasPython("torch")) return null;
  return withTemp("gtm-sync-", async (tmp) => {
    const src = await writeDataUrl(path.join(tmp, "in.mp4"), media);
    try {
      const common = ["--videofile", src, "--reference", "gtm", "--data_dir", tmp];
      await run(toolPath.python(), ["run_pipeline.py", ...common], { cwd: dir, timeout: 600_000, maxBuffer: 32 * 1024 * 1024 });
      const { stdout } = await run(toolPath.python(), ["run_syncnet.py", ...common], { cwd: dir, timeout: 600_000, maxBuffer: 32 * 1024 * 1024 });
      const offset = Number(stdout.match(/AV offset:\s*(-?\d+)/)?.[1]);
      const confidence = Number(stdout.match(/Confidence:\s*([\d.]+)/)?.[1]);
      return Number.isFinite(offset) && Number.isFinite(confidence) ? { offset, confidence } : null;
    } catch {
      return null;
    }
  });
}

/** Integrated loudness and true peak of a mix (EBU R128). */
export async function loudness(media: string): Promise<{ lufs: number; peak: number } | null> {
  return withTemp("gtm-loud-", async (dir) => {
    const src = await writeDataUrl(path.join(dir, "in.mp4"), media);
    try {
      const { stderr } = await run(FFMPEG, ["-hide_banner", "-nostats", "-i", src, "-map", "0:a:0", "-af", "ebur128=peak=true", "-f", "null", "-"], { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
      const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
      const lufs = Number(summary.match(/\bI:\s+(-?[\d.]+) LUFS/)?.[1]);
      const peak = Number(summary.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1]);
      return Number.isFinite(lufs) ? { lufs, peak } : null;
    } catch {
      return null;
    }
  });
}

/** Cut times from PySceneDetect's "Comma-separated timecode list" log line. */
export function parseSceneList(log: string) {
  const line = log.split(/\r?\n/).findIndex((l) => l.includes("Comma-separated timecode list"));
  if (line < 0) return [];
  const list = log.split(/\r?\n/)[line + 1] ?? "";
  return [...list.matchAll(/(\d+):(\d+):([\d.]+)/g)].map((m) => Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
}
