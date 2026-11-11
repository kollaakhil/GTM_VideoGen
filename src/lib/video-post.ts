import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";

const run = promisify(execFile);
const FFMPEG = ffmpegPath || "ffmpeg";
const FONTS = path.join(process.cwd(), "assets", "fonts");

export const ASPECTS = [
  { aspect: "9:16", w: 9, h: 16 },
  { aspect: "4:5", w: 4, h: 5 },
  { aspect: "1:1", w: 1, h: 1 },
] as const;

const assTime = (t: number) => {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = (t % 60).toFixed(2).padStart(5, "0");
  return `${h}:${String(m).padStart(2, "0")}:${s}`;
};

/** Splits a voiceover script into short caption chunks spread evenly over the clip. */
export function captionCues(script: string, duration: number, wordsPerCue = 4) {
  const words = script.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length || duration <= 0) return [];
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerCue) chunks.push(words.slice(i, i + wordsPerCue).join(" "));
  const step = duration / chunks.length;
  return chunks.map((text, i) => ({ start: i * step, end: Math.min(duration, (i + 1) * step), text }));
}

function assFile(cues: { start: number; end: number; text: string }[], w: number, h: number) {
  const size = Math.round(Math.min(w, h) * 0.075);
  const marginV = Math.round(h * 0.2);
  const esc = (t: string) => t.replace(/[{}\\]/g, "").toUpperCase();
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV",
    `Style: Cap,DejaVu Sans,${size},&H00FFFFFF,&H00000000,&H80000000,1,1,${Math.max(2, Math.round(size / 10))},0,2,${Math.round(w * 0.08)},${Math.round(w * 0.08)},${marginV}`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Text",
    ...cues.map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Cap,${esc(c.text)}`),
  ].join("\n");
}

async function probe(file: string) {
  const out = await run(FFMPEG, ["-hide_banner", "-i", file], { timeout: 30_000 }).catch((e) => e as { stderr?: string });
  const err = String(out.stderr ?? "");
  const d = err.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const s = err.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
  return {
    duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0,
    width: s ? Number(s[1]) : 720,
    height: s ? Number(s[2]) : 1280,
    audio: /Audio:/.test(err),
  };
}

/** Burns captions from the script into the video and renders 9:16, 4:5 and 1:1 cuts (center crop). */
export async function captionVariants(video: string, script: string): Promise<{ aspect: string; url: string }[]> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gtm-cap-"));
  try {
    const input = path.join(dir, "in.mp4");
    await fs.writeFile(input, video.startsWith("data:") ? Buffer.from(video.split(",")[1], "base64") : await (await fetch(video)).arrayBuffer().then(Buffer.from));
    const src = await probe(input);
    const cues = captionCues(script, src.duration);
    const results: { aspect: string; url: string }[] = [];
    for (const a of ASPECTS) {
      let w = src.width;
      let h = Math.round((src.width * a.h) / a.w);
      if (h > src.height) {
        h = src.height;
        w = Math.round((src.height * a.w) / a.h);
      }
      w -= w % 2;
      h -= h % 2;
      const ass = path.join(dir, `${a.w}x${a.h}.ass`);
      await fs.writeFile(ass, assFile(cues, w, h));
      const out = path.join(dir, `${a.w}x${a.h}.mp4`);
      const vf = `crop=${w}:${h}${cues.length ? `,subtitles=${ass}:fontsdir=${FONTS}` : ""}`;
      await run(
        FFMPEG,
        ["-hide_banner", "-loglevel", "error", "-i", input, "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", ...(src.audio ? ["-c:a", "copy"] : ["-an"]), "-movflags", "+faststart", "-y", out],
        { timeout: 180_000 },
      );
      results.push({ aspect: a.aspect, url: `data:video/mp4;base64,${(await fs.readFile(out)).toString("base64")}` });
    }
    return results;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
