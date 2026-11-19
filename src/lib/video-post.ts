import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import type { CopyCue } from "./media-qa";
import { energyMap, layoutCopy, shotOverlays } from "./caption-layout";
import { detectBeats, snapCuts } from "./beat-sync";
import { type SfxCue, sfxFile } from "./sfx";

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
export function captionCues(script: string, duration: number, wordsPerCue = 4, verbatim = false) {
  const words = (verbatim ? script : spokenScript(script)).trim().split(/\s+/).filter(Boolean);
  if (!words.length || duration <= 0) return [];
  // Break at punctuation first so a cue never splits a short phrase; avoid leaving a lone trailing word.
  const chunks: string[] = [];
  let cur: string[] = [];
  for (const [i, w] of words.entries()) {
    cur.push(w);
    if (/[.,!?;:]$/.test(w) || (cur.length >= wordsPerCue && words.length - i - 1 !== 1)) {
      chunks.push(cur.join(" "));
      cur = [];
    }
  }
  if (cur.length) chunks.push(cur.join(" "));
  const step = duration / chunks.length;
  return chunks.map((text, i) => ({ start: i * step, end: Math.min(duration, (i + 1) * step), text }));
}

/**
 * Captions and overlays as ASS. Every line sits on its own tight box (BorderStyle 3: the box hugs the text, padded by
 * the outline width) that exists only while that line is on screen. Compact copy (the OCR-safe re-typeset) uses a
 * slightly darker box and smaller type; it never paints fixed full-frame panels over the product.
 */
export const captionSize = (w: number, h: number, compact = false) => Math.round(Math.min(w, h) * (compact ? 0.058 : 0.075));

export function assFile(cues: { start: number; end: number; text: string }[], w: number, h: number, overlays: CopyCue[] = [], compact = false, layout?: ReturnType<typeof layoutCopy>) {
  const size = captionSize(w, h, compact);
  // ASS alpha: 00 opaque … FF clear. ~70% (compact ~80%) opaque keeps white text readable for OCR and viewers.
  const box = compact ? "&H30000000" : "&H48000000";
  const pad = (s: number) => Math.max(4, Math.round(s * 0.28));
  const marginV = Math.round(h * 0.2);
  const esc = (t: string) => t.replace(/[{}\\]/g, "");
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV",
    `Style: Cap,DejaVu Sans,${size},&H00FFFFFF,${box},&H00000000,1,3,${pad(size)},0,2,${Math.round(w * 0.08)},${Math.round(w * 0.08)},${marginV}`,
    `Style: Overlay,DejaVu Sans,${Math.round(size * 0.8)},&H00FFFFFF,${box},&H00000000,1,3,${pad(size * 0.8)},0,8,${Math.round(w * 0.12)},${Math.round(w * 0.12)},${Math.round(h * 0.14)}`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Text",
    ...(layout
      ? [
        // Placed lines: centred on the slot picked to keep the product and subject clear (caption-layout.ts).
        ...layout.captions.map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Cap,{\\an5\\pos(${Math.round(w / 2)},${Math.round(c.y * h)})}${esc(c.text)}`),
        ...layout.overlays.map((c) => `Dialogue: 1,${assTime(c.start)},${assTime(c.end)},Overlay,{\\an5\\pos(${Math.round(w / 2)},${Math.round(c.y * h)})}${esc(c.text.replace(/\s+/g, " "))}`),
      ]
      : [
        ...cues.map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Cap,${esc(c.text)}`),
        ...overlays.map((c) => `Dialogue: 1,${assTime(c.start)},${assTime(c.end)},Overlay,${esc(c.text.replace(/\s+/g, " "))}`),
      ]),
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
export type EndCard = { brand: string; line?: string; cta?: string; footer?: string; color?: string; logo?: string | null; fontFile?: string | null; fontFamily?: string | null };

const CTA_LABEL: Record<string, string> = { SHOP_NOW: "Shop now", LEARN_MORE: "Learn more", SIGN_UP: "Sign up", GET_OFFER: "Get offer", ORDER_NOW: "Order now" };
const endCopy = (end: EndCard) => ({ brand: end.brand, line: end.line, cta: end.cta ? CTA_LABEL[end.cta] ?? end.cta : undefined, footer: end.footer });
/** End card hold. 1.5 s was too short to read an offer line and a footer badge (script judge, run_8a9c7c9db627). */
export const END_SECONDS = 2.5;
const endTs = `0:00:${END_SECONDS.toFixed(2).padStart(5, "0")}`;

export function expectedCopy(segments: { start: number; end: number; text: string; onScreen?: string }[], end: EndCard, duration: number): CopyCue[] {
  return [
    ...shotOverlays(segments).map((o): CopyCue => ({ ...o, layer: "overlay" })),
    ...timedCues(segments).map((c): CopyCue => ({ ...c, layer: "caption" })),
    ...(["brand", "line", "cta", "footer"] as const).flatMap((position): CopyCue[] => {
      const text = endCopy(end)[position];
      return text ? [{ text, start: duration, end: duration + END_SECONDS, layer: "end", position }] : [];
    }),
  ];
}

/** Readable text colour (black/white) for a hex background. */
function inkFor(hex: string): "black" | "white" {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "black" : "white";
}

function endCardAss(end: EndCard, ink: "black" | "white", w: number, h: number) {
  const c = ink === "white" ? "&H00FFFFFF" : "&H00000000";
  const clean = (t: string) => t.replace(/[{}\\\n]/g, " ").trim();
  const line = end.line ? clean(end.line) : "";
  const fit = (n: number, len: number) => Math.round(Math.min(n, (w * 1.7) / Math.max(len, 1)));
  const ev = (size: number, y: number, text: string, box = false) =>
    `Dialogue: 0,0:00:00.00,${endTs},${box ? "Box" : "Card"},{\\an5\\pos(${Math.round(w / 2)},${y})\\fs${size}}${text}`;
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV",
    `Style: Card,${end.fontFamily || "DejaVu Sans"},40,${c},${c},&H00000000,1,1,0,0,5,0,0,0`,
    `Style: Box,${end.fontFamily || "DejaVu Sans"},40,${ink === "white" ? "&H00000000" : "&H00FFFFFF"},${c},${c},1,3,${Math.round(h / 90)},0,5,0,0,0`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Text",
    ev(fit(h / 11, end.brand.length), Math.round(h * 0.4), clean(end.brand)),
    ...(line ? [ev(fit(h / 28, line.length), Math.round(h * 0.52), line)] : []),
    ...(end.cta ? [ev(fit(h / 18, end.cta.length), Math.round(h * 0.64), CTA_LABEL[end.cta] ?? clean(end.cta))] : []),
    ...(end.footer ? [ev(fit(h / 34, end.footer.length), Math.round(h * 0.76), clean(end.footer))] : []),
  ].join("\n");
}

/** Burns captions, crops to each aspect and appends a typeset end card (brand, offer line, CTA) so the wordmark is always spelled right. */
/** Caption cues timed to each shot's window instead of spread evenly over the whole video. */
export function timedCues(segments: { start: number; end: number; text: string }[], wordsPerCue = 4) {
  return segments.flatMap((s) => captionCues(s.text, s.end - s.start, wordsPerCue, true).map((c) => ({ ...c, start: c.start + s.start, end: c.end + s.start })));
}

const toFile = async (dir: string, name: string, media: string) => {
  const f = path.join(dir, name);
  await fs.writeFile(f, media.startsWith("data:") ? Buffer.from(media.split(",")[1], "base64") : Buffer.from(await (await fetch(media)).arrayBuffer()));
  return f;
};

/**
 * Joins shot clips into one 720x1280 30fps video. With a voiceover and/or music bed the model audio is replaced
 * by a mix (voice on top, music ducked under it); otherwise each clip's own audio is kept.
 */
export async function stitchShots(clips: string[], audio: { voices?: { url: string; start: number; tempo?: number }[]; music?: string | null; shotSeconds?: number[]; width?: number; beatSync?: boolean; sfx?: SfxCue[] } = {}): Promise<{ url: string; starts: number[]; duration: number; beats?: number[]; snapped?: number }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gtm-stitch-"));
  try {
    const norm: string[] = [];
    const starts: number[] = [];
    let t = 0;
    const srcs = await Promise.all(clips.map((c, i) => toFile(dir, `c${i}.mp4`, c)));
    const infos = await Promise.all(srcs.map(probe));
    // Beat sync: move each cut to the nearest music beat the clips have slack for; voices follow their shot.
    let planned = audio.shotSeconds;
    let beats: number[] | undefined, snapped: number | undefined;
    const musicFile = audio.music ? await toFile(dir, "music.mp3", audio.music) : null;
    if (audio.beatSync && musicFile && planned?.length) {
      const b = await detectBeats(musicFile);
      if (b) {
        const s = snapCuts(planned, [...new Set([...b.beats, ...b.onsets])].sort((x, y) => x - y), infos.map((x) => x.duration));
        const oldStarts = planned.map((_, i) => planned!.slice(0, i).reduce((a, x) => a + x, 0));
        const newStarts = s.seconds.map((_, i) => s.seconds.slice(0, i).reduce((a, x) => a + x, 0));
        audio = { ...audio, voices: audio.voices?.map((v) => {
          const k = oldStarts.reduce((best, st, i) => (st <= v.start + 1e-6 ? i : best), 0);
          return { ...v, start: Number((v.start - oldStarts[k] + newStarts[k]).toFixed(3)) };
        }) };
        planned = s.seconds;
        beats = b.beats;
        snapped = s.snapped;
      }
    }
    for (const [i] of clips.entries()) {
      const src = srcs[i];
      const info = infos[i];
      const duration = planned?.[i] ?? info.duration;
      if (!(duration > 0) || info.duration + 0.12 < duration) throw new Error(`Shot ${i + 1} is shorter than its planned ${duration}s.`);
      const w = audio.width ?? 720;
      const h = Math.round(w * 16 / 9 / 2) * 2;
      const out = path.join(dir, `n${i}.mp4`);
      await run(
        FFMPEG,
        [
          "-hide_banner", "-loglevel", "error", "-i", src,
          ...(info.audio ? [] : ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"]),
          "-vf", `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=30,format=yuv420p`,
          "-map", "0:v", "-map", info.audio ? "0:a" : "1:a", "-af", "apad", "-t", String(duration),
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-ar", "44100", "-ac", "2", "-y", out,
        ],
        { timeout: 180_000 },
      );
      starts.push(t);
      t += duration;
      norm.push(out);
    }
    const joined = path.join(dir, "joined.mp4");
    const inputs = norm.flatMap((f) => ["-i", f]);
    const fc = norm.map((_, i) => `[${i}:v][${i}:a]`).join("") + `concat=n=${norm.length}:v=1:a=1[v][a]`;
    await run(FFMPEG, ["-hide_banner", "-loglevel", "error", ...inputs, "-filter_complex", fc, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-y", joined], { timeout: 240_000 });
    let final = joined;
    if (audio.voices?.length || audio.music || audio.sfx?.length) {
      final = path.join(dir, "mixed.mp4");
      const extra: string[] = [];
      const parts: string[] = [];
      const labels: string[] = [];
      let k = 1;
      for (const [i, v] of (audio.voices ?? []).entries()) {
        // Speed-fit each line in its own pass: chaining atempo into adelay/amix yields silence in ffmpeg 7.
        const raw = await toFile(dir, `vo${i}.mp3`, v.url);
        const fitted = path.join(dir, `vo${i}.wav`);
        const tempo = v.tempo && v.tempo > 1.01 ? ["-af", `atempo=${Math.min(v.tempo, 1.5).toFixed(3)}`] : [];
        await run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-i", raw, ...tempo, "-ar", "44100", "-ac", "2", "-y", fitted], { timeout: 60_000 });
        extra.push("-i", fitted);
        const ms = Math.round(v.start * 1000);
        parts.push(`[${k++}:a]adelay=${ms}|${ms}[vo${i}]`);
        labels.push(`[vo${i}]`);
      }
      const sfxFiles = new Map<string, string>();
      for (const [j, c] of (audio.sfx ?? []).entries()) {
        const at = (starts[c.shot] ?? 0) + c.offset;
        if (c.shot >= starts.length || at < 0 || at > t - 0.2) continue;
        if (!sfxFiles.has(c.kind)) sfxFiles.set(c.kind, await sfxFile(c.kind, dir));
        extra.push("-i", sfxFiles.get(c.kind)!);
        const ms = Math.round(at * 1000);
        parts.push(`[${k++}:a]volume=${c.gain.toFixed(3)},adelay=${ms}|${ms}[fx${j}]`);
        labels.push(`[fx${j}]`);
      }
      if (audio.music) {
        extra.push("-stream_loop", "-1", "-i", musicFile!);
        parts.push(`[${k++}:a]aresample=44100,aformat=channel_layouts=stereo,volume=${labels.length ? 0.18 : 0.6},afade=t=out:st=${Math.max(0, t - 1).toFixed(2)}:d=1[mu]`);
        labels.push("[mu]");
      }
      const mix = labels.length > 1 ? `${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0` : `${labels[0]}anull`;
      await run(
        FFMPEG,
        ["-hide_banner", "-loglevel", "error", "-i", joined, ...extra, "-filter_complex", `${parts.join(";")};${mix},apad=whole_dur=${t},loudnorm=I=-14:LRA=7:TP=-1.5[a]`, "-map", "0:v", "-map", "[a]", "-t", t.toFixed(2), "-c:v", "copy", "-c:a", "aac", "-ar", "44100", "-b:a", "160k", "-y", final],
        { timeout: 180_000 },
      );
    }
    return { url: `data:video/mp4;base64,${(await fs.readFile(final)).toString("base64")}`, starts, duration: t, beats, snapped };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Mean loudness in dB (about -91 means digital silence). */
export async function meanVolume(media: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gtm-vol-"));
  try {
    const f = await toFile(dir, "m", media);
    const out = await run(FFMPEG, ["-hide_banner", "-i", f, "-vn", "-af", "volumedetect", "-f", "null", "-"], { timeout: 60_000 }).catch((e) => e as { stderr?: string });
    const m = String(out.stderr ?? "").match(/mean_volume: (-?[\d.]+) dB/);
    return m ? Number(m[1]) : -91;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** Audio length in seconds (for fitting a voiceover to shots). */
export async function mediaDuration(media: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gtm-probe-"));
  try {
    return (await probe(await toFile(dir, "m", media))).duration;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** The copy to OCR on one export: lines where they were placed on that aspect, plus the fixed end card. */
export const placedCues = (v: { copy?: CopyCue[] }, cues: CopyCue[]) => v.copy ? [...v.copy, ...cues.filter((c) => c.layer === "end")] : cues;

export async function captionVariants(
  video: string,
  script: string,
  end?: EndCard,
  segments?: { start: number; end: number; text: string; onScreen?: string }[],
  aspects: readonly (typeof ASPECTS)[number]["aspect"][] = ASPECTS.map((a) => a.aspect),
  compactCopy = false,
): Promise<{ aspect: string; url: string; copy?: CopyCue[] }[]> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gtm-cap-"));
  try {
    const input = path.join(dir, "in.mp4");
    await fs.writeFile(input, video.startsWith("data:") ? Buffer.from(video.split(",")[1], "base64") : await (await fetch(video)).arrayBuffer().then(Buffer.from));
    const src = await probe(input);
    const cues = segments?.length ? timedCues(segments) : captionCues(script, src.duration);
    const overlays = shotOverlays(segments ?? []).map((o): CopyCue => ({ ...o, layer: "overlay" }));
    const results: { aspect: string; url: string; copy?: CopyCue[] }[] = [];
    for (const a of ASPECTS.filter((row) => aspects.includes(row.aspect))) {
      let w = src.width;
      let h = Math.round((src.width * a.h) / a.w);
      if (h > src.height) {
        h = src.height;
        w = Math.round((src.height * a.w) / a.h);
      }
      w -= w % 2;
      h -= h % 2;
      const ass = path.join(dir, `${a.w}x${a.h}.ass`);
      const out = path.join(dir, `${a.w}x${a.h}.mp4`);
      const spatial = (segments?.length || compactCopy) && a.aspect !== "9:16"
        ? `scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=0x151515`
        : `crop=${w}:${h}`;
      // Shot-timed copy is placed where the frame is quietest so it never sits on the product (see caption-layout.ts).
      let layout: ReturnType<typeof layoutCopy> | undefined;
      if (segments?.length && (cues.length || overlays.length)) {
        const size = captionSize(w, h, compactCopy);
        layout = layoutCopy(await energyMap(input, spatial, w, h), w, h, segments, cues, { caption: size, overlay: Math.round(size * 0.8) });
      }
      await fs.writeFile(ass, assFile(cues, w, h, overlays, compactCopy, layout));
      const vf = [spatial, ...(cues.length || overlays.length ? [`subtitles=${ass}:fontsdir=${FONTS}`] : [])].join(",");
      const enc = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-y", out];
      if (!end) {
        await run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-i", input, "-vf", vf, ...enc.slice(0, 8), ...(src.audio ? ["-c:a", "copy"] : ["-an"]), ...enc.slice(8)], { timeout: 180_000 });
      } else {
        const bg = /^#[0-9a-f]{6}$/i.test(end.color ?? "") ? end.color! : "#111111";
        const ink = inkFor(bg);
        const endAss = path.join(dir, `${a.w}x${a.h}-end.ass`);
        await fs.writeFile(endAss, endCardAss(end, ink, w, h));
        let fontsDir = FONTS;
        if (end.fontFile) {
          fontsDir = path.join(dir, "fonts");
          await fs.mkdir(fontsDir, { recursive: true });
          await fs.copyFile(end.fontFile, path.join(fontsDir, path.basename(end.fontFile)));
          await fs.copyFile(path.join(FONTS, "DejaVuSans-Bold.ttf"), path.join(fontsDir, "DejaVuSans-Bold.ttf"));
        }
        const logoFile = end.logo ? await toFile(dir, `logo-${a.w}x${a.h}.png`, end.logo) : null;
        const logoIdx = src.audio ? 3 : 2;
        const logoChain = logoFile ? `[v1raw];[${logoIdx}:v]scale=${Math.round(w * 0.42)}:-1[lg];[v1raw][lg]overlay=(W-w)/2:H*0.16:shortest=1` : "";
        const card = `subtitles=${endAss}:fontsdir=${fontsDir},setsar=1,fps=30,format=yuv420p${logoChain}`;
        const fc = src.audio
          ? `[0:v]${vf},setsar=1,fps=30,format=yuv420p[v0];[1:v]${card}[v1];[0:a]aresample=44100,aformat=channel_layouts=stereo[a0];[2:a]aformat=channel_layouts=stereo[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]`
          : `[0:v]${vf},setsar=1,fps=30,format=yuv420p[v0];[1:v]${card}[v1];[v0][v1]concat=n=2:v=1:a=0[v]`;
        await run(
          FFMPEG,
          [
            "-hide_banner", "-loglevel", "error", "-i", input,
            "-f", "lavfi", "-i", `color=c=0x${bg.slice(1)}:s=${w}x${h}:d=${END_SECONDS}:r=30`,
            ...(src.audio ? ["-f", "lavfi", "-t", String(END_SECONDS), "-i", "anullsrc=r=44100:cl=stereo"] : []),
            ...(logoFile ? ["-loop", "1", "-t", String(END_SECONDS), "-i", logoFile] : []),
            "-filter_complex", fc, "-map", "[v]", ...(src.audio ? ["-map", "[a]", "-c:a", "aac", "-b:a", "128k"] : ["-an"]), ...enc,
          ],
          { timeout: 180_000 },
        );
      }
      const copy = layout ? [
        ...layout.overlays.map((o): CopyCue => ({ start: o.start, end: o.end, text: o.text, layer: "overlay", box: o.box })),
        ...layout.captions.map((c): CopyCue => ({ start: c.start, end: c.end, text: c.text, layer: "caption", box: c.box })),
      ] : undefined;
      results.push({ aspect: a.aspect, url: `data:video/mp4;base64,${(await fs.readFile(out)).toString("base64")}`, copy });
    }
    return results;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export type StaticKit = { brand: string; headline: string; offer?: string | null; footer?: string | null; cta?: string | null; primary?: string | null; logo?: string | null; fontFile?: string | null; fontFamily?: string | null };

/** Greedy word wrap to a max characters per line. */
export function wrapLines(text: string, max: number, maxLines = 3) {
  const lines: string[] = [];
  for (const w of text.replace(/\s+/g, " ").trim().split(" ")) {
    const last = lines[lines.length - 1];
    if (last && (last + " " + w).length <= max) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  if (lines.length > maxLines) lines.splice(maxLines - 1, lines.length, lines.slice(maxLines - 1).join(" "));
  return lines;
}

/** The offer line printed on a static ad: the first sentence of the offer, with no mid-word cut. Clauses are trimmed later by fitOffer. */
export function offerLine(raw: string | null | undefined): string {
  return (raw ?? "").split(/\.(?:\s|$)|[;\n]/)[0].replace(/[{}\\]/g, " ").replace(/\s+/g, " ").trim();
}

/** Average glyph width of bold sans text as a share of the font size (DejaVu Sans Bold runs wide, so this is conservative). */
const GLYPH_EM = 0.6;
const OFFER_MAX_PX = 940;

/**
 * Fits the offer inside maxPx on at most maxLines lines. Tries the base size, then smaller sizes, then drops trailing
 * comma clauses, and finally cuts at the last whole word, so the offer never runs off the image or stops mid-word.
 */
export function fitOffer(raw: string, o: { maxPx?: number; maxLines?: number; sizes?: number[] } = {}): { lines: string[]; size: number; text: string } {
  const maxPx = o.maxPx ?? OFFER_MAX_PX;
  const maxLines = o.maxLines ?? 2;
  const sizes = o.sizes ?? [44, 40, 36];
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return { lines: [], size: sizes[0], text: "" };
  const perLine = (size: number) => Math.floor(maxPx / (size * GLYPH_EM));
  const fits = (t: string, size: number) => {
    const lines = wrapLines(t, perLine(size), Number.MAX_SAFE_INTEGER);
    return lines.length <= maxLines && lines.every((l) => l.length <= perLine(size)) ? lines : null;
  };
  const clauses = text.split(/\s*,\s*/).filter(Boolean);
  for (let keep = clauses.length; keep >= 1; keep--) {
    const t = clauses.slice(0, keep).join(", ");
    for (const size of sizes) {
      const lines = fits(t, size);
      if (lines) return { lines, size, text: t };
    }
  }
  const size = sizes[sizes.length - 1];
  const max = perLine(size);
  const words = clauses[0].split(" ");
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && `${last} ${w}`.length <= max) lines[lines.length - 1] = `${last} ${w}`;
    else if (lines.length < maxLines && w.length <= max) lines.push(w);
    else break;
  }
  return { lines, size, text: lines.join(" ") };
}

const assColor = (hex: string) => `&H00${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`.toUpperCase();

/**
 * Typesets a static ad in code: the image model only paints the scene; headline, offer, CTA and logo are laid out
 * with the brand font so text is always spelled right and on-brand. Output 1080x1350 (4:5) PNG data URL.
 */
export async function typesetStatic(background: string, kit: StaticKit, o: { tighter?: number } = {}): Promise<string> {
  const W = 1080;
  const H = 1350;
  // Each "tighter" step (used when QA flags text layout) shrinks type ~10% and narrows the text block.
  const t = Math.max(0, Math.min(3, o.tighter ?? 0));
  const k = 1 - 0.1 * t;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gtm-static-"));
  try {
    const bg = await toFile(dir, "bg.img", background);
    const clean = (t: string) => t.replace(/[{}\\\n]/g, " ").trim();
    const headline = clean(kit.headline);
    const size = Math.round((headline.length > 48 ? 70 : headline.length > 30 ? 82 : 96) * k);
    const textPx = OFFER_MAX_PX - 40 * t;
    const lines = wrapLines(headline, Math.floor(textPx / (size * 0.56)));
    const primary = /^#[0-9a-f]{6}$/i.test(kit.primary ?? "") ? kit.primary! : "#111111";
    const ink = inkFor(primary);
    const font = kit.fontFamily || "DejaVu Sans";
    const fitted = kit.offer ? fitOffer(offerLine(clean(kit.offer)), { maxPx: textPx, sizes: [44, 40, 36].map((n) => Math.round(n * k)) }) : null;
    const offer = fitted?.lines.length ? fitted.lines.join("\\N") : "";
    const offerSize = fitted?.size ?? 44;
    const footer = kit.footer ? clean(kit.footer).slice(0, 80) : "";
    const ctaY = H - (footer ? 150 : 110);
    const offerY = ctaY - 100;
    const offerExtra = fitted && fitted.lines.length > 1 ? Math.round((fitted.lines.length - 1) * offerSize * 1.2) : 0;
    const headBottom = offer ? offerY - 60 - offerExtra : ctaY - 90;
    const ev = (style: string, an: number, x: number, y: number, text: string, extra = "") => `Dialogue: 0,0:00:00.00,0:00:05.00,${style},{\\an${an}\\pos(${x},${y})${extra}}${text}`;
    const ass = [
      "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${W}`, `PlayResY: ${H}`, "WrapStyle: 2", "",
      "[V4+ Styles]",
      "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV",
      `Style: Head,${font},${size},&H00FFFFFF,&H00000000,&H64000000,1,1,0,3,1,0,0,0`,
      `Style: Offer,${font},${offerSize},&H00FFFFFF,&H00000000,&H64000000,1,1,0,2,1,0,0,0`,
      `Style: Cta,${font},44,${ink === "white" ? "&H00FFFFFF" : "&H00000000"},${assColor(primary)},${assColor(primary)},1,3,22,0,1,0,0,0`,
      `Style: Foot,${font},30,&H00E6E6E6,&H00000000,&H64000000,0,1,0,2,1,0,0,0`,
      "", "[Events]", "Format: Layer, Start, End, Style, Text",
      ev("Head", 1, 70, headBottom, lines.join("\\N")),
      ...(offer ? [ev("Offer", 1, 70, offerY, offer)] : []),
      ...(kit.cta ? [ev("Cta", 1, 92, ctaY, CTA_LABEL[kit.cta] ?? clean(kit.cta))] : []),
      ...(footer ? [ev("Foot", 1, 70, H - 50, footer)] : []),

    ].join("\n");
    await fs.writeFile(path.join(dir, "t.ass"), ass);
    let fontsDir = FONTS;
    if (kit.fontFile) {
      fontsDir = path.join(dir, "fonts");
      await fs.mkdir(fontsDir, { recursive: true });
      await fs.copyFile(kit.fontFile, path.join(fontsDir, path.basename(kit.fontFile)));
      await fs.copyFile(path.join(FONTS, "DejaVuSans-Bold.ttf"), path.join(fontsDir, "DejaVuSans-Bold.ttf"));
    }
    const logo = kit.logo ? await toFile(dir, "logo.png", kit.logo) : null;
    const scrim = `color=c=black:s=${W}x${H}:d=1,format=rgba,geq=r='0':g='0':b='0':a='if(lt(Y,H*0.16),120*(1-Y/(H*0.16)),if(lt(Y,H*0.38),0,200*pow((Y-H*0.38)/(H*0.62),1.1)))'[sc]`;
    const base = `${scrim};[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,format=rgba[bg0];[bg0][sc]overlay=0:0,format=rgb24,subtitles=${path.join(dir, "t.ass")}:fontsdir=${fontsDir}`;
    const fc = logo ? `${base}[b];[1:v]scale=260:-1[lg];[b][lg]overlay=70:60` : base;
    const out = path.join(dir, "out.png");
    await run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-i", bg, ...(logo ? ["-i", logo] : []), "-filter_complex", fc, "-frames:v", "1", "-y", out], { timeout: 60_000 });
    return `data:image/png;base64,${(await fs.readFile(out)).toString("base64")}`;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** First sharp frame of a video as a JPEG (thumbnails for ad platforms). */
export async function posterFrame(video: string): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "poster-"));
  try {
    const out = path.join(dir, "poster.jpg");
    await run(FFMPEG, ["-y", "-ss", "0.5", "-i", video, "-frames:v", "1", "-q:v", "2", out]);
    return await fs.readFile(out);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
