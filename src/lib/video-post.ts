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

/** Keeps only spoken words: drops speaker labels (VO:, SFX:), bracketed/parenthesised directions and notes. */
export function spokenScript(script: string) {
  return script
    .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, " ")
    .replace(/\b[A-Z][A-Z /&-]{1,24}:\s*/g, " ")
    .replace(/["“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits a voiceover script into short caption chunks spread evenly over the clip. */
export function captionCues(script: string, duration: number, wordsPerCue = 4) {
  const words = spokenScript(script).split(" ").filter(Boolean);
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
export type EndCard = { brand: string; line?: string; cta?: string; color?: string };

const CTA_LABEL: Record<string, string> = { SHOP_NOW: "Shop now", LEARN_MORE: "Learn more", SIGN_UP: "Sign up", GET_OFFER: "Get offer", ORDER_NOW: "Order now" };

/** Readable text colour (black/white) for a hex background. */
function inkFor(hex: string): "black" | "white" {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "black" : "white";
}

function endCardAss(end: EndCard, ink: "black" | "white", w: number, h: number) {
  const c = ink === "white" ? "&H00FFFFFF" : "&H00000000";
  const clean = (t: string) => t.replace(/[{}\\\n]/g, " ").trim();
  const line = end.line ? clean(end.line).slice(0, 40) : "";
  const fit = (n: number, len: number) => Math.round(Math.min(n, (w * 1.7) / Math.max(len, 1)));
  const ev = (size: number, y: number, text: string, box = false) =>
    `Dialogue: 0,0:00:00.00,0:00:01.50,${box ? "Box" : "Card"},{\\an5\\pos(${Math.round(w / 2)},${y})\\fs${size}}${text}`;
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV",
    `Style: Card,DejaVu Sans,40,${c},${c},&H00000000,1,1,0,0,5,0,0,0`,
    `Style: Box,DejaVu Sans,40,${ink === "white" ? "&H00000000" : "&H00FFFFFF"},${c},${c},1,3,${Math.round(h / 90)},0,5,0,0,0`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Text",
    ev(fit(h / 11, end.brand.length), Math.round(h * 0.4), clean(end.brand)),
    ...(line ? [ev(fit(h / 28, line.length), Math.round(h * 0.52), line)] : []),
    ...(end.cta ? [ev(Math.round(h / 26), Math.round(h * 0.64), CTA_LABEL[end.cta] ?? clean(end.cta), true)] : []),
  ].join("\n");
}

/** Burns captions, crops to each aspect and appends a typeset end card (brand, offer line, CTA) so the wordmark is always spelled right. */
export async function captionVariants(video: string, script: string, end?: EndCard): Promise<{ aspect: string; url: string }[]> {
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
      const enc = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-y", out];
      if (!end) {
        await run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-i", input, "-vf", vf, ...enc.slice(0, 8), ...(src.audio ? ["-c:a", "copy"] : ["-an"]), ...enc.slice(8)], { timeout: 180_000 });
      } else {
        const bg = /^#[0-9a-f]{6}$/i.test(end.color ?? "") ? end.color! : "#111111";
        const ink = inkFor(bg);
        const endAss = path.join(dir, `${a.w}x${a.h}-end.ass`);
        await fs.writeFile(endAss, endCardAss(end, ink, w, h));
        const card = `subtitles=${endAss}:fontsdir=${FONTS},setsar=1,fps=30,format=yuv420p`;
        const fc = src.audio
          ? `[0:v]${vf},setsar=1,fps=30,format=yuv420p[v0];[1:v]${card}[v1];[0:a]aresample=44100,aformat=channel_layouts=stereo[a0];[2:a]aformat=channel_layouts=stereo[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]`
          : `[0:v]${vf},setsar=1,fps=30,format=yuv420p[v0];[1:v]${card}[v1];[v0][v1]concat=n=2:v=1:a=0[v]`;
        await run(
          FFMPEG,
          [
            "-hide_banner", "-loglevel", "error", "-i", input,
            "-f", "lavfi", "-i", `color=c=0x${bg.slice(1)}:s=${w}x${h}:d=1.5:r=30`,
            ...(src.audio ? ["-f", "lavfi", "-t", "1.5", "-i", "anullsrc=r=44100:cl=stereo"] : []),
            "-filter_complex", fc, "-map", "[v]", ...(src.audio ? ["-map", "[a]", "-c:a", "aac", "-b:a", "128k"] : ["-an"]), ...enc,
          ],
          { timeout: 180_000 },
        );
      }
      results.push({ aspect: a.aspect, url: `data:video/mp4;base64,${(await fs.readFile(out)).toString("base64")}` });
    }
    return results;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
