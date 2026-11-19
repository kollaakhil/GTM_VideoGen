import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { exactCopy, sameSpeech } from "./script-lab";
import type { QualityFinding, Shot, VideoQuality } from "./types";
import { shotReady, videoAspects, VIDEO_PASS } from "./quality-policy";

const run = promisify(execFile);
const ffmpeg = ffmpegPath || "ffmpeg";
const args = { timeout: 45_000, maxBuffer: 4 * 1024 * 1024 };

/** `box` (fractions of the frame) is where the line was actually drawn; OCR then reads only that box. */
export type CopyCue = { start: number; end: number; text: string; layer: "overlay" | "caption" | "end"; position?: "brand" | "line" | "cta" | "footer"; box?: { x: number; y: number; w: number; h: number } };

/**
 * OCR filter for one cue. A placed caption is read from its own box (plus a small margin) and binarised: the copy is
 * white on a dark box, so anything darker than near-white becomes background. Reading the fixed 58–82% band used to
 * feed Tesseract the can label and fruit, which came back as noise ("35 Cal *¢ Og Added Sugars ee ae").
 */
export function ocrFilter(cue: CopyCue) {
  if (cue.box && cue.layer !== "end") {
    const m = 0.012;
    const x = Math.max(0, cue.box.x - m), y = Math.max(0, cue.box.y - m);
    const w = Math.min(1 - x, cue.box.w + 2 * m), h = Math.min(1 - y, cue.box.h + 2 * m);
    const f = (n: number) => n.toFixed(4);
    return `crop=iw*${f(w)}:ih*${f(h)}:iw*${f(x)}:ih*${f(y)},scale=1200:-2,format=gray,lutyuv=y='if(gt(val,185),0,255)'`;
  }
  const crop = cue.layer === "caption" ? "crop=iw*0.88:ih*0.24:iw*0.06:ih*0.58," :
    cue.layer === "overlay" ? "crop=iw*0.84:ih*0.33:iw*0.08:ih*0.125," :
    cue.position === "brand" ? "crop=iw:ih*0.18:0:ih*0.31," :
    cue.position === "line" ? "crop=iw:ih*0.105:0:ih*0.47," :
    cue.position === "cta" ? "crop=iw:ih*0.14:0:ih*0.57," :
    cue.position === "footer" ? "crop=iw:ih*0.08:0:ih*0.72," : "";
  return `${crop}scale=840:-2,format=gray`;
}
export type SpeechWindow = { start: number; end: number; text: string; shotId?: string };

async function withMedia<T>(media: string, using: (file: string, dir: string) => Promise<T>) {
  const encoded = /^data:(?:video|audio)\/[\w.+-]+;base64,([\w+/=]+)$/.exec(media)?.[1];
  if (!encoded) throw new Error("QA requires local audio or video bytes.");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gtm-export-qa-"));
  try {
    const file = path.join(dir, "input");
    await fs.writeFile(file, Buffer.from(encoded, "base64"));
    return await using(file, dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const sec = (n: number) => Math.max(0, n).toFixed(3);

async function imageAt(file: string, at: number, filter: string) {
  const { stdout } = await run(ffmpeg, ["-v", "error", "-ss", sec(at), "-i", file, "-frames:v", "1", "-vf", filter, "-f", "image2pipe", "-vcodec", "png", "-threads", "1", "-"], { ...args, encoding: "buffer" });
  if (!stdout.length) throw new Error("No frame at this timestamp");
  return stdout;
}

export function frameTimes(start: number, end: number) {
  const len = end - start;
  return [...new Set([0.04, 0.25, 0.5, 0.75, 0.96].map((t) => Number((start + t * len).toFixed(3))))];
}

export async function evidenceFrames(media: string, times: number[], window?: { start: number; end: number }) {
  return withMedia(media, async (file) => {
    const frames = [];
    for (const at of window ? await aroundCuts(file, times, window) : times) {
      const png = await imageAt(file, at, "scale=360:-2");
      frames.push({ at, url: `data:image/png;base64,${png.toString("base64")}` });
    }
    return frames;
  });
}

async function aroundCuts(file: string, times: number[], { start, end }: { start: number; end: number }) {
  const { stderr } = await run(ffmpeg, ["-hide_banner", "-nostats", "-ss", sec(start), "-i", file, "-t", sec(end - start), "-an", "-vf", "scale=240:-2,scdet=t=14", "-f", "null", "-"], args);
  const cuts = [...stderr.matchAll(/lavfi\.scd\.time:\s*([\d.]+)/g)].slice(0, 2).map((m) => start + Number(m[1]));
  const neighborhoods = cuts.flatMap((at) => [at - 0.07, at + 0.07]).filter((at) => at > start && at < end - 0.04);
  return [...new Set([...times, ...neighborhoods.map((at) => Number(at.toFixed(3)))])].sort((a, b) => a - b);
}

export async function videoTechnicalFindings(media: string, end: number, aspect?: string, checkFreeze = true) {
  return withMedia(media, async (file) => scan(file, end, aspect, checkFreeze));
}

async function scan(file: string, end: number, aspect?: string, checkFreeze = true, deliberateEnd?: number): Promise<QualityFinding[]> {
  const findings: QualityFinding[] = [];
  const add = (at: number, expected: string, observed: string, status: QualityFinding["status"] = "fail") => {
    findings.push({ at, kind: "technical", aspect, expected, observed, status });
  };
  try {
    const { stderr } = await run(ffmpeg, ["-hide_banner", "-nostats", "-xerror", "-i", file, "-map", "0:v:0", "-an", "-vf", `scale=240:-2,blackdetect=d=0.06:pix_th=0.035${checkFreeze ? ",freezedetect=n=-55dB:d=0.35" : ""},showinfo=checksum=0`, "-f", "null", "-"], { ...args, maxBuffer: 12 * 1024 * 1024 });
    const dimensions = stderr.match(/showinfo[^\n]*\bs:(\d+)x(\d+)/);
    if (aspect && dimensions) {
      const [w, h] = aspect.split(":").map(Number);
      if (Math.abs(Number(dimensions[1]) / Number(dimensions[2]) - w / h) > 0.005) add(0, `A ${aspect} export`, `${dimensions[1]}×${dimensions[2]} pixels`);
    }
    if (!dimensions) add(0, "A decodable video stream", "No decoded frames");
    const last = stderr.slice(stderr.lastIndexOf("pts_time:")).match(/pts_time:([\d.]+)/)?.[1];
    if (last === undefined || Number(last) < end - 0.12) add(Number(last ?? 0), `Frames through ${end.toFixed(2)}s`, "Export ends before the planned timeline");
    for (const m of stderr.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)) {
      if (Number(m[1]) < (deliberateEnd ?? end) - 0.05) add(Number(m[1]), "A visible image", `Black frames until ${m[2]}s`);
    }
    for (const m of stderr.matchAll(/freeze_start:\s*([\d.]+)/g)) {
      if (Number(m[1]) < end - 0.36) add(Number(m[1]), "Continuous motion", "Frames appear frozen");
    }
  } catch {
    add(0, "A fully decodable video stream", "FFmpeg could not complete the scan", "review");
  }
  return findings.slice(0, 16);
}

export async function localOcrAvailable() {
  try {
    const { stdout } = await run(process.env.TESSERACT_BIN || "tesseract", ["--list-langs"], args);
    return stdout.split(/\r?\n/).includes(process.env.OCR_LANG || "eng");
  } catch { return false; }
}

export async function checkExport(media: string, aspect: string, duration: number, cues: CopyCue[]) {
  return withMedia(media, async (file) => {
    const card = cues.find((c) => c.layer === "end");
    const findings = await scan(file, duration, aspect, false, card?.start);
    const readings = new Map<string, string>();
    for (const cue of cues.filter((c) => exactCopy(c.text))) {
      const at = (cue.start + cue.end) / 2;
      try {
        const key = `${at}:${cue.layer}:${cue.position ?? ""}`;
        if (!readings.has(key)) {
          const image = await imageAt(file, at, ocrFilter(cue));
          const stdout = await new Promise<string>((resolve, reject) => {
            const p = execFile(process.env.TESSERACT_BIN || "tesseract", ["stdin", "stdout", "-l", process.env.OCR_LANG || "eng", "--psm", cue.layer === "end" ? "7" : "6"], args, (err, out) => err ? reject(err) : resolve(out));
            p.stdin?.on("error", () => {});
            p.stdin?.end(image);
          });
          readings.set(key, stdout);
        }
        const stdout = readings.get(key)!;
        if (!` ${exactCopy(stdout)} `.includes(` ${exactCopy(cue.text)} `)) {
          findings.push({ kind: "copy", aspect, at, expected: cue.text, observed: stdout.replace(/\s+/g, " ").trim().slice(0, 250) || "No readable text detected", status: stdout.trim() ? "fail" : "review" });
        }
      } catch {
        findings.push({ kind: "coverage", aspect, at, expected: cue.text, observed: "OCR could not verify the exported frame", status: "review" });
      }
    }
    return findings;
  });
}

export async function audioFindings(media: string, contentDuration: number, aspect?: string): Promise<QualityFinding[]> {
  return withMedia(media, async (file) => {
    const expected = "Audible narration mix from -30 to -9 LUFS with at least 0.5 dB headroom";
    try {
      const { stderr } = await run(ffmpeg, ["-hide_banner", "-nostats", "-i", file, "-map", "0:a:0", "-t", sec(contentDuration), "-af", "ebur128=peak=true:framelog=verbose", "-f", "null", "-"], args);
      const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
      const loudness = Number(summary.match(/\bI:\s+(-?[\d.]+) LUFS/)?.[1]);
      const peak = Number(summary.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1]);
      if (loudness >= -30 && loudness <= -9 && peak <= -0.5) return [];
      const observed = Number.isFinite(loudness) && loudness > -70 ? `${loudness} LUFS; ${Number.isFinite(peak) ? peak + " dBFS peak" : "peak unavailable"}` : "No audible audio detected";
      return [{ kind: "technical", aspect, at: 0, expected, observed, status: "fail" }];
    } catch {
      return [{ kind: "technical", aspect, at: 0, expected, observed: "No audio stream or the audio scan failed", status: "review" }];
    }
  });
}

const localModel = () => process.env.WHISPER_MODEL_PATH;

async function audioWindow(file: string, out: string, start?: number, end?: number) {
  await run(ffmpeg, ["-v", "error", ...(start !== undefined ? ["-ss", sec(start)] : []), "-i", file, ...(end !== undefined && start !== undefined ? ["-t", sec(end - start)] : []), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-y", out], args);
}

/**
 * Spelling hints for speech-to-text: coined brand words and domains only ("OLIPOP", "drinkolipop.com"), never the
 * whole expected line, so ordinary mis-speech still shows up. Without it whisper heard "drinkolipop.com" as
 * "drinkallapop.com" / "drinkoleopop.com" on clean TTS and export QA failed the CTA every time.
 */
export function asrVocabulary(text: string, brand = "") {
  const domains = text.match(/\b[a-z0-9-]+\.(?:com|co|io|ai|net|org|shop|store)\b/gi) ?? [];
  const coined = text.match(/\b(?:[A-Z]{3,}[A-Za-z]*|[A-Z][a-z]+[A-Z][A-Za-z]*)\b/g) ?? [];
  return [...new Set([...(brand.trim() ? [brand.trim()] : []), ...coined, ...domains])].slice(0, 8).join(", ");
}

async function recognize(wav: string, transcribe: (audio: string) => Promise<{ text: string; usage: { costUsd: number } }>, hint = "") {
  const model = localModel();
  if (!model) return transcribe(`data:audio/wav;base64,${(await fs.readFile(wav)).toString("base64")}`);
  const output = wav + "-asr";
  await run(process.env.WHISPER_BIN || "whisper-cli", ["-m", model, "-f", wav, "-l", process.env.WHISPER_LANG || "en", "-nt", "-np", ...(hint ? ["--prompt", hint] : []), "-otxt", "-of", output], args);
  return { text: (await fs.readFile(output + ".txt", "utf8")).trim(), usage: { costUsd: 0 } };
}

type Transcriber = Parameters<typeof recognize>[1];

/** `hint` is a whisper --prompt (asrVocabulary): without it "swap in OLIPOP" came back "swapping all a pop". */
export function transcribeLine(media: string, transcribe: Transcriber, hint = "") {
  return withMedia(media, async (file, dir) => {
    const wav = path.join(dir, "line.wav");
    await audioWindow(file, wav);
    return recognize(wav, transcribe, hint);
  });
}

/** `vocabulary`: brand names to hint (e.g. "OLIPOP"); domains and coined words in each line are added automatically. */
export async function verifySpeech(media: string, windows: SpeechWindow[], transcribe: Transcriber, vocabulary = "") {
  return withMedia(media, async (file, dir) => {
    const findings: QualityFinding[] = [];
    let cost = 0;
    for (const [i, w] of windows.entries()) {
      try {
        const wav = path.join(dir, `spoken-${i}.wav`);
        await audioWindow(file, wav, w.start, w.end);
        const heard = await recognize(wav, transcribe, asrVocabulary(w.text, vocabulary));
        cost += heard.usage.costUsd;
        if (!sameSpeech(heard.text, w.text)) findings.push({ kind: "speech", shotId: w.shotId, at: w.start, expected: w.text || "No speech", observed: heard.text || "No words heard", status: "fail" });
      } catch {
        findings.push({ kind: "coverage", shotId: w.shotId, at: w.start, expected: w.text, observed: "Speech verification could not run", status: "review" });
      }
    }
    return { findings, cost };
  });
}

export function exportVerdict(tier: VideoQuality["tier"], score: number, shots: VideoQuality["shots"], findings: QualityFinding[], aspects: string[]): VideoQuality {
  return {
    tier, score, shots, findings, aspects,
    status: findings.some((f) => f.status === "fail") ? "fail"
      : findings.length || !shots.length || shots.some((s) => !shotReady(s.qa)) || !videoAspects(tier).every((a) => aspects.includes(a)) || !Number.isFinite(score) ? "review"
      : score < VIDEO_PASS ? "fail" : "pass",
  };
}

export function reusableShot(s: Shot, key: string) {
  return !!s.clip && !!s.clipModel && s.clipKey === key && shotReady(s.clipQa);
}
