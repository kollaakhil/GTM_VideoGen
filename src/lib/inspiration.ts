import { execFile } from "node:child_process";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { z } from "zod";
import { chatJSON, type Part } from "./ai";
import { run, withTemp, writeDataUrl } from "./local-tools";
import { sceneCuts, wordTimings } from "./qa-tools";
import { assertPublicUrl, safeFetchText } from "./safe-fetch";
import type { InspirationBreakdown, Swipe } from "./types";

/**
 * Inspiration breakdown: measures an inspiration ad's structure (cuts, pacing, hook timing, speech rate, on-screen
 * text, framing, lens, motion) so scripts and shot lists can borrow its shape. Only structure is stored and passed
 * on: no footage is reused and spoken or printed lines are never quoted.
 */
const FFMPEG = ffmpegPath || "ffmpeg";
const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
const frameCount = () => Math.max(1, Math.min(6, Number(process.env.INSPIRATION_FRAMES) || 4));

export type InspirationInput = { url?: string; upload?: string; name?: string };

const Shot = z.object({ framing: z.string().max(80), lens: z.string().max(80), motion: z.string().max(80), purpose: z.string().max(120), textStyle: z.string().max(120) });
const Review = z.object({
  format: z.string().max(80),
  hook: z.string().max(240),
  pacing: z.string().max(200),
  textStyle: z.string().max(200),
  whyItWorks: z.string().max(240),
  beats: z.array(z.string().max(120)).max(8),
  shots: z.array(Shot.partial()).max(8),
});

/** True when `text` repeats six or more consecutive words of `source` (a verbatim line, not structure). */
export function copiesLine(text: string, source: string, n = 6) {
  const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  const src = words(source);
  if (src.length < n) return false;
  const grams = new Set(src.slice(0, src.length - n + 1).map((_, i) => src.slice(i, i + n).join(" ")));
  const t = words(text);
  return t.some((_, i) => i + n <= t.length && grams.has(t.slice(i, i + n).join(" ")));
}

/** Shot boundaries from cut times, merging slivers shorter than 0.3s. */
export function shotWindows(cuts: number[], duration: number) {
  const points = [0, ...cuts.filter((c) => c > 0.3 && c < duration - 0.3).sort((a, b) => a - b), duration];
  const out: { start: number; end: number }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    if (points[i + 1] - points[i] < 0.3 && out.length) out[out.length - 1].end = points[i + 1];
    else out.push({ start: points[i], end: points[i + 1] });
  }
  return out;
}

/** Pacing numbers from cuts and word timings. */
export function pacing(windows: { start: number; end: number }[], duration: number, words: { start: number; end: number }[] | null) {
  const lengths = windows.map((w) => w.end - w.start);
  const avgShotSec = lengths.length ? +(lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(2) : duration;
  const spoken = words?.length ? words[words.length - 1].end - words[0].start : 0;
  return {
    shotCount: windows.length,
    avgShotSec,
    cutsPerSec: duration > 0 ? +((windows.length - 1) / duration).toFixed(2) : 0,
    firstCutSec: windows.length > 1 ? +windows[0].end.toFixed(2) : null,
    firstWordSec: words?.length ? +words[0].start.toFixed(2) : null,
    wordsPerSec: words?.length && spoken > 0.5 ? +(words.length / spoken).toFixed(2) : null,
  };
}

async function probeDuration(file: string) {
  const out = await run(FFMPEG, ["-hide_banner", "-i", file], { timeout: 30_000 }).catch((e) => e as { stderr?: string });
  const d = String(out.stderr ?? "").match(/Duration: (\d+):(\d+):([\d.]+)/);
  return d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0;
}

async function frameAt(file: string, at: number) {
  const { stdout } = await run(FFMPEG, ["-v", "error", "-ss", at.toFixed(3), "-i", file, "-frames:v", "1", "-vf", "scale=360:-2", "-f", "image2pipe", "-vcodec", "png", "-"], { timeout: 30_000, encoding: "buffer", maxBuffer: 8 * 1024 * 1024 });
  return stdout as Buffer;
}

/** On-screen text per frame with Tesseract: we keep only where text sits and how much there is, never the words. */
async function textLayout(png: Buffer): Promise<{ words: number; zone: "top" | "middle" | "bottom" | null } | null> {
  try {
    const tsv = await new Promise<string>((resolve, reject) => {
      const p = execFile(process.env.TESSERACT_BIN || "tesseract", ["stdin", "stdout", "-l", process.env.OCR_LANG || "eng", "--psm", "11", "tsv"], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => err ? reject(err) : resolve(out));
      p.stdin?.on("error", () => {});
      p.stdin?.end(png);
    });
    const rows = tsv.split("\n").slice(1).map((l) => l.split("\t")).filter((c) => c.length >= 12 && Number(c[10]) >= 70 && /\w{2,}/.test(c[11]));
    if (!rows.length) return { words: 0, zone: null };
    const height = Math.max(...tsv.split("\n").slice(1).map((l) => l.split("\t")).filter((c) => c[0] === "1").map((c) => Number(c[9]) || 0), 1);
    const mid = rows.reduce((s, c) => s + Number(c[7]) + Number(c[9]) / 2, 0) / rows.length / height;
    return { words: rows.length, zone: mid < 0.34 ? "top" : mid > 0.66 ? "bottom" : "middle" };
  } catch {
    return null;
  }
}

/** Full breakdown of one inspiration video (data URL). */
async function breakdownVideo(media: string, source: string, visionModel: string): Promise<InspirationBreakdown> {
  return withTemp("gtm-insp-", async (dir) => {
    const file = await writeDataUrl(path.join(dir, "in.mp4"), media);
    const duration = await probeDuration(file);
    if (!(duration > 0)) throw new Error("The inspiration video could not be read.");
    const via: InspirationBreakdown["via"] = { cuts: "none", transcript: "none", ocr: "none", vision: "none" };
    const cut = await sceneCuts(media).catch(() => null);
    if (cut) via.cuts = cut.via;
    const windows = shotWindows(cut?.cuts ?? [], duration);
    const timed = await wordTimings(media).catch(() => null);
    if (timed) via.transcript = timed.via;
    const stats = pacing(windows, duration, timed?.words ?? null);
    const picked = windows.length <= frameCount() ? windows : Array.from({ length: frameCount() }, (_, i) => windows[Math.round((i * (windows.length - 1)) / (frameCount() - 1 || 1))]);
    const frames: { at: number; png: Buffer; text: Awaited<ReturnType<typeof textLayout>> }[] = [];
    for (const w of picked) {
      const at = Math.min(w.start + Math.min(0.6, (w.end - w.start) / 2), duration - 0.05);
      const png = await frameAt(file, at).catch(() => null);
      if (!png?.length) continue;
      const text = await textLayout(png);
      if (text) via.ocr = "tesseract";
      frames.push({ at, png, text });
    }
    const transcript = timed?.words.map((w) => w.word).join(" ") ?? "";
    const review = await describe(visionModel, frames.map((f) => ({ at: f.at, url: `data:image/png;base64,${f.png.toString("base64")}`, text: f.text })), { duration, ...stats }, transcript).catch(() => null);
    if (review) via.vision = "vlm";
    const thumb = frames[0] ? `data:image/png;base64,${frames[0].png.toString("base64")}` : null;
    return {
      id: "", source, kind: "video", duration: +duration.toFixed(2), ...stats, via, thumb,
      textOnScreen: frames.filter((f) => f.text?.words).map((f) => ({ at: +f.at.toFixed(2), words: f.text!.words, zone: f.text!.zone })),
      shots: picked.map((w, i) => ({ start: +w.start.toFixed(2), end: +w.end.toFixed(2), framing: review?.data.shots[i]?.framing ?? "", lens: review?.data.shots[i]?.lens ?? "", motion: review?.data.shots[i]?.motion ?? "", purpose: review?.data.shots[i]?.purpose ?? "", textStyle: review?.data.shots[i]?.textStyle ?? "" })),
      format: review?.data.format ?? "", hook: review?.data.hook ?? "", pacing: review?.data.pacing ?? "", textStyle: review?.data.textStyle ?? "", whyItWorks: review?.data.whyItWorks ?? "", beats: review?.data.beats ?? [],
      costUsd: review?.cost ?? 0,
    };
  });
}

/** One cheap vision call over a few keyframes. Its paraphrases are dropped if they quote the transcript. */
async function describe(model: string, frames: { at: number; url: string; text: Awaited<ReturnType<typeof textLayout>> }[], stats: Record<string, unknown>, transcript: string, pageText = "") {
  if (!frames.length && !pageText) throw new Error("Nothing to describe");
  const parts: Part[] = [
    {
      type: "text",
      text: `Break down this reference ad's STRUCTURE so another brand can borrow its shape. Describe, never quote: no spoken or printed lines, names, slogans or logos.
Measured: ${JSON.stringify(stats)}.${transcript ? ` The narration has ${transcript.split(/\s+/).length} words (content withheld on purpose).` : ""}${pageText ? `\nAd page context (do not quote): ${pageText.slice(0, 1500)}` : ""}
For each numbered frame give framing (e.g. extreme close-up, medium, wide, top-down), lens feel (wide/normal/telephoto/macro), camera motion (static, handheld, push-in, whip pan…), the shot's purpose in the ad (hook, problem, demo, proof, CTA) and text style (none, bold captions bottom, kinetic title top…).
Return JSON {"format":string,"hook":string (how the first 2 seconds grab attention, paraphrased),"pacing":string,"textStyle":string,"whyItWorks":string,"beats":[string],"shots":[{"framing","lens","motion","purpose","textStyle"}]} with one shot per frame in order.`,
    },
    ...frames.flatMap((f, i): Part[] => [{ type: "text", text: `Frame ${i + 1} at ${f.at.toFixed(2)}s${f.text ? `; OCR found ${f.text.words} words${f.text.zone ? ` in the ${f.text.zone}` : ""}` : ""}` }, { type: "image_url", image_url: { url: f.url } }]),
  ];
  const { data, usage } = await chatJSON<unknown>(model, "You are a creative strategist who reverse-engineers ad structure. Return only JSON.", parts);
  const parsed = Review.safeParse(data);
  if (!parsed.success) throw new Error("Incomplete breakdown");
  const clean = (s: string) => (transcript && copiesLine(s, transcript)) || (pageText && copiesLine(s, pageText)) ? "" : s;
  const r = parsed.data;
  return {
    data: { ...r, hook: clean(r.hook), pacing: clean(r.pacing), whyItWorks: clean(r.whyItWorks), beats: r.beats.map(clean).filter(Boolean), shots: r.shots.map((s) => ({ framing: s.framing ?? "", lens: s.lens ?? "", motion: s.motion ?? "", purpose: clean(s.purpose ?? ""), textStyle: s.textStyle ?? "" })) },
    cost: usage.costUsd,
  };
}

async function breakdownImage(image: string, source: string, visionModel: string, pageText = ""): Promise<InspirationBreakdown> {
  const review = await describe(visionModel, image ? [{ at: 0, url: image, text: null }] : [], { still: true }, "", pageText).catch(() => null);
  return {
    id: "", source, kind: pageText ? "page" : "image", duration: 0, shotCount: 1, avgShotSec: 0, cutsPerSec: 0, firstCutSec: null, firstWordSec: null, wordsPerSec: null,
    via: { cuts: "none", transcript: "none", ocr: "none", vision: review ? "vlm" : "none" }, thumb: image.startsWith("data:") ? image : null, textOnScreen: [],
    shots: review?.data.shots.slice(0, 1).map((s) => ({ start: 0, end: 0, ...s })) ?? [],
    format: review?.data.format ?? "", hook: review?.data.hook ?? "", pacing: review?.data.pacing ?? "", textStyle: review?.data.textStyle ?? "", whyItWorks: review?.data.whyItWorks ?? "", beats: review?.data.beats ?? [],
    costUsd: review?.cost ?? 0,
  };
}

/** Downloads a public file with SSRF checks and a size cap; returns a data URL. */
async function download(url: string, accept: RegExp): Promise<string | null> {
  const res = await fetch(await assertPublicUrl(url), { redirect: "follow", signal: AbortSignal.timeout(30_000), headers: { "User-Agent": "Mozilla/5.0 GTM-Engine" } });
  const type = res.headers.get("content-type")?.split(";")[0] ?? "";
  if (!res.ok || !accept.test(type) || Number(res.headers.get("content-length") ?? 0) > MAX_VIDEO_BYTES) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > MAX_VIDEO_BYTES ? null : `data:${type};base64,${buf.toString("base64")}`;
}

const meta = (html: string, prop: string) =>
  html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']+)["']`, "i"))?.[1] ??
  html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${prop}["']`, "i"))?.[1];

/**
 * Breaks down one inspiration: an uploaded video or image, a direct video/image link, or a page (its og:video,
 * else og:image plus page text). Missing tools degrade the breakdown; they never fail the run.
 */
export async function breakdownInspiration(input: InspirationInput, visionModel: string): Promise<{ breakdown: InspirationBreakdown; note: string | null }> {
  const source = input.url ?? `upload: ${input.name ?? "file"}`;
  if (input.upload?.startsWith("data:video/")) return { breakdown: await breakdownVideo(input.upload, source, visionModel), note: null };
  if (input.upload?.startsWith("data:image/")) return { breakdown: await breakdownImage(input.upload, source, visionModel), note: null };
  if (!input.url) throw new Error("Add a link or a file.");
  if (/\.(mp4|mov|webm|m4v)(\?|$)/i.test(input.url)) {
    const video = await download(input.url, /^video\//);
    if (video) return { breakdown: await breakdownVideo(video, source, visionModel), note: null };
  }
  if (/\.(png|jpe?g|webp)(\?|$)/i.test(input.url)) {
    const image = await download(input.url, /^image\//);
    if (image) return { breakdown: await breakdownImage(image, source, visionModel), note: null };
  }
  const html = await safeFetchText(input.url);
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, " ").replace(/\s+/g, " ").slice(0, 4000);
  const og = (p: string) => { const v = meta(html, p); try { return v ? new URL(v.replace(/&amp;/g, "&"), input.url).toString() : null; } catch { return null; } };
  const ogVideo = og("og:video:secure_url") ?? og("og:video:url") ?? og("og:video");
  if (ogVideo) {
    const video = await download(ogVideo, /^video\//).catch(() => null);
    if (video) return { breakdown: await breakdownVideo(video, source, visionModel), note: null };
  }
  const ogImage = og("og:image");
  const image = ogImage ? await download(ogImage, /^image\//).catch(() => null) : null;
  const breakdown = image ? await breakdownImage(image, source, visionModel, text) : await breakdownImage("", source, visionModel, text);
  return { breakdown, note: ogVideo || /youtube|youtu\.be|tiktok|instagram|facebook/.test(input.url) ? "Couldn't download the video from that page, so only the page was analysed. Upload the file for a full cut-by-cut breakdown." : null };
}

/** Swipe structure from a breakdown, so the script writer and inspiration-match judge pick it up. */
export function swipeStructure(b: InspirationBreakdown): NonNullable<Swipe["structure"]> {
  return {
    hook: b.hook || (b.firstCutSec ? `First cut at ${b.firstCutSec}s` : "Reference hook"),
    beats: b.beats.length ? b.beats : b.shots.map((s) => s.purpose).filter(Boolean),
    format: b.format || (b.kind === "video" ? "Video ad" : "Static ad"),
    whyItWorks: b.whyItWorks || b.pacing,
  };
}

/** Structural guidance for the shot planner (never content). */
export function inspirationGuidance(breakdowns: InspirationBreakdown[]) {
  const videos = breakdowns.filter((b) => b.kind === "video" && b.shotCount > 0);
  if (!videos.length) return "";
  const lines = videos.slice(0, 3).map((b) => {
    const mix = (k: "framing" | "lens" | "motion") => [...new Set(b.shots.map((s) => s[k]).filter(Boolean))].slice(0, 4).join(", ");
    return `- ${b.duration}s, ${b.shotCount} shots (avg ${b.avgShotSec}s)${b.firstCutSec ? `, first cut at ${b.firstCutSec}s` : ""}${b.wordsPerSec ? `, ${b.wordsPerSec} words/s` : ""}${mix("framing") ? `; framing: ${mix("framing")}` : ""}${mix("lens") ? `; lens: ${mix("lens")}` : ""}${mix("motion") ? `; motion: ${mix("motion")}` : ""}${b.textStyle ? `; text: ${b.textStyle}` : ""}${b.pacing ? `; pacing: ${b.pacing}` : ""}`;
  });
  return `\nInspiration structure (borrow rhythm, framing, lens and motion only; never their footage, people, lines or marks):\n${lines.join("\n")}`;
}
