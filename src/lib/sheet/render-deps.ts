import path from "node:path";
import { chatJSON, voiceover, musicBed } from "@/lib/ai";
import { qa } from "@/lib/pipeline";
import { checkExport, type CopyCue } from "@/lib/media-qa";
import { loudness } from "@/lib/qa-tools";
import { fileCache, type CacheStore } from "@/lib/render/cache";
import { aiVideoRenderer, blenderRenderer, remotionRenderer } from "@/lib/render/renderers";
import { mediaDataUrl, storeMedia } from "@/lib/store";
import { stitchShots } from "@/lib/video-post";
import { designSound } from "@/lib/audio/sound-design";
import { generateVideoToAudioSfx, selectVoice } from "@/lib/audio/generate";
import { generateSfxWithFallback, generateMusicWithFallback, type FallbackWarning } from "@/lib/audio/fallback";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import fs from "node:fs/promises";
import os from "node:os";
import type { RenderDeps } from "./render";
import { DEFAULT_VIDEO_MODEL, videoPricePerSec } from "./version-estimate";
import type { SheetRun } from "./run-types";
import { migrateModelId } from "@/lib/registry/migrations";

const run = promisify(execFile);

/** Persistent caches: off under vitest unless RENDER_CACHE=1, so unrelated tests never see each other's results. */
function cacheStore<T>(name: string): CacheStore<T> {
  if (process.env.VITEST && process.env.RENDER_CACHE !== "1") return { get: async () => undefined, set: async () => {} };
  return fileCache<T>(path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "render-cache", name));
}

/** One frame of a clip at `at` seconds, as a JPEG data URL. */
async function frameAt(clip: string, at: number): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sheet-frame-"));
  try {
    const src = path.join(dir, "in.mp4");
    await fs.writeFile(src, Buffer.from((await mediaDataUrl(clip)).split(",")[1], "base64"));
    const out = path.join(dir, "f.jpg");
    await run(ffmpegPath || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(at), "-i", src, "-frames:v", "1", "-vf", "scale=640:-2", "-y", out], { timeout: 30_000 });
    return `data:image/jpeg;base64,${(await fs.readFile(out)).toString("base64")}`;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/**
 * A free drone bed for the sheet's "bed" line (foley-first keeps action sounds on top): a sub sine at the pitch the
 * line names (default 45 Hz) with an octave and a low brown-noise rumble, slow swell, fade in and a 2 s fade out.
 */
export async function droneBed(description: string, seconds: number): Promise<string> {
  const hz = Math.min(120, Math.max(30, Number(description.match(/(\d{2,3})\s*hz/i)?.[1] ?? 45)));
  const d = Math.max(2, seconds + 0.5).toFixed(2);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sheet-bed-"));
  try {
    const out = path.join(dir, "bed.wav");
    const graph = `sine=f=${hz}:d=${d}:r=44100[a];sine=f=${hz * 2}:d=${d}:r=44100,volume=0.35[b];anoisesrc=d=${d}:c=brown:a=0.25:r=44100,lowpass=f=180[c];[a][b][c]amix=inputs=3:normalize=0,tremolo=f=0.25:d=0.25,afade=t=in:d=1,afade=t=out:st=${(Number(d) - 2).toFixed(2)}:d=2,volume=0.8`;
    await run(ffmpegPath || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-filter_complex", graph, "-ac", "2", "-y", out], { timeout: 60_000 });
    return `data:audio/wav;base64,${(await fs.readFile(out)).toString("base64")}`;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/** The real thing: renderers, the cheap vision check, FFmpeg stitching and the strict review tools. */
export const DEFAULT_SHEET_VIDEO_MODEL = () => process.env.SHEET_VIDEO_MODEL || DEFAULT_VIDEO_MODEL;

export function defaultRenderDeps(stackModels?: Partial<Record<string, string>>, jobContext?: { runId: string; versionId: string; priority?: "high" | "normal" }): RenderDeps {
  const sheetModel = (r: SheetRun) => r.input.visionModel;
  // Resolve models from stack or fallback to env/defaults, migrating deprecated IDs
  const videoModel = (stackModels?.video && stackModels.video !== "auto" ? stackModels.video : "") || process.env.SHEET_VIDEO_MODEL || "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video";
  const qaModel = migrateModelId(stackModels?.qa || process.env.SHEET_VISION_MODEL || "google/gemini-3.8-flash");
  const voiceModel = stackModels?.voice ? migrateModelId(stackModels.voice) : undefined; // undefined means use voiceover's VOICE_MODEL default
  const asset3dModel = stackModels?.asset3d ? migrateModelId(stackModels.asset3d) : undefined; // undefined means use generateProductMesh's auto
  const sfxModel = migrateModelId(stackModels?.sfx || "mirelo-ai/sfx2.0/text-to-audio");
  const musicModel = migrateModelId(stackModels?.music || "elevenlabs/music/v2.5");
  
  return {
    renderers: { 
      "ai-video": aiVideoRenderer({ defaultModel: videoModel, pricePerSec: videoPricePerSec }), 
      blender: blenderRenderer(jobContext ? { jobContext: { ...jobContext, jobId: `${jobContext.runId}-${jobContext.versionId}` } } : {}), 
      remotion: remotionRenderer() 
    },
    autoBlender: process.env.RENDER_AUTO_BLENDER === "1",
    jobContext: jobContext ? { ...jobContext, jobId: `${jobContext.runId}-${jobContext.versionId}` } : undefined,
    photos: async (r) => Promise.all(r.input.photos.map((p) => mediaDataUrl(p))),
    store: (data, key) => storeMedia(data, key),
    shotCheck: {
      frame: frameAt,
      // One cheap vision call per shot. Model comes from stack QA model or run default.
      review: async (frame, expected) => {
        const { data } = await chatJSON<{ score: number; notes?: string[] }>(
          qaModel,
          "You check one frame of a draft ad shot against what the shot sheet says should be on screen. Be literal and brief. Reply JSON: {\"score\": 0-10, \"notes\": [one short sentence]}. 10 = exactly as written, 7 = usable, below 7 = wrong subject, missing action or unreadable.",
          [{ type: "text", text: `Expected on screen: ${expected}` }, { type: "image_url", image_url: { url: frame } }],
        );
        return { score: Number(data.score) || 0, notes: data.notes ?? [] };
      },
    },
    stitch: async (clips, a) => {
      const clipData = await Promise.all(clips.map((c) => mediaDataUrl(c)));
      const voices = await Promise.all(a.voices.map(async (v) => ({ ...v, url: await mediaDataUrl(v.url) })));
      // Cast sfx to any to allow both SfxCue and GeneratedSfxCue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated cues carry a url the SfxCue union does not model yet
      return stitchShots(clipData, { voices, music: a.music, shotSeconds: a.shotSeconds, width: a.width, height: a.height, beatSync: false, sfx: a.sfx as any, duck: a.duck, bedGain: a.bedGain, silenceGaps: a.silenceGaps });
    },
    bed: async (description, seconds) => {
      // Only generate a drone if the bed description explicitly requests one
      if (!description || description.trim() === "") return null;
      const hasDrone = /drone|synth|pad|hum|ambient/i.test(description);
      if (!hasDrone) return null;
      return droneBed(description, seconds);
    },
    voice: async (line, run, voiceName) => {
      const voice = voiceName || "Rachel";
      const v = await voiceover(line, voice, undefined, voiceModel);
      return { url: v.url, usd: v.usage.costUsd };
    },
    soundDesign: async (run) => {
      if (!run.sheet || !run.brief) return null;
      const textModel = run.input.visionModel;
      // Pass run.input.patternId directly (no optional workaround)
      const { plan, usd } = await designSound(run.sheet, run.brief, textModel, run.input.patternId);
      return plan;
    },
    selectVoice: (persona, brand) => selectVoice(persona, brand),
    generateSfx: async (videoUrl, textPrompt, durationSeconds) => {
      // Use fallback chain - never silently fails
      const result = await generateSfxWithFallback(textPrompt, durationSeconds, sfxModel);
      
      // Log visible warning if fallback was used
      if (result.warning) {
        console.warn(`⚠️  [AUDIO FALLBACK] SFX: ${result.warning.primary} → ${result.warning.fallback}`);
        console.warn(`    Reason: ${result.warning.reason}`);
      }
      
      return { url: result.url, usd: result.usage.costUsd };
    },
    generateMusic: async (prompt, seconds) => {
      // Use fallback chain for music
      const result = await generateMusicWithFallback(prompt, seconds, musicModel);
      
      // Log visible warning if fallback was used
      if (result.warning) {
        console.warn(`⚠️  [AUDIO FALLBACK] Music: ${result.warning.primary} → ${result.warning.fallback}`);
        console.warn(`    Reason: ${result.warning.reason}`);
      }
      
      return result.url;
    },
    burnCaptions: async (video, cues, width, height) => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gtm-cap-"));
      try {
        const videoFile = path.join(dir, "in.mp4");
        await fs.writeFile(videoFile, video.startsWith("data:") ? Buffer.from(video.split(",")[1], "base64") : await (await fetch(video)).arrayBuffer().then(Buffer.from));
        
        // Generate ASS subtitle file for chunked captions
        const size = Math.round(Math.min(width, height) * 0.075);
        const pad = Math.max(4, Math.round(size * 0.28));
        const marginV = Math.round(height * 0.2);
        const assTime = (t: number) => {
          const h = Math.floor(t / 3600);
          const m = Math.floor((t % 3600) / 60);
          const s = (t % 60).toFixed(2).padStart(5, "0");
          return `${h}:${String(m).padStart(2, "0")}:${s}`;
        };
        const esc = (t: string) => t.replace(/[{}\\]/g, "");
        const assContent = [
          "[Script Info]",
          "ScriptType: v4.00+",
          `PlayResX: ${width}`,
          `PlayResY: ${height}`,
          "",
          "[V4+ Styles]",
          "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV",
          `Style: Cap,DejaVu Sans,${size},&H00FFFFFF,&H48000000,&H00000000,1,3,${pad},0,2,${Math.round(width * 0.08)},${Math.round(width * 0.08)},${marginV}`,
          "",
          "[Events]",
          "Format: Layer, Start, End, Style, Text",
          ...cues.map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Cap,${esc(c.text)}`),
        ].join("\n");
        
        const assFile = path.join(dir, "captions.ass");
        await fs.writeFile(assFile, assContent);
        
        const output = path.join(dir, "out.mp4");
        const FFMPEG = ffmpegPath || "ffmpeg";
        await run(FFMPEG, [
          "-hide_banner", "-loglevel", "error",
          "-i", videoFile,
          "-vf", `ass=${assFile.replace(/\\/g, "\\\\")}`,
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
          "-c:a", "copy",
          "-y", output,
        ], { timeout: 180_000 });
        
        return `data:video/mp4;base64,${(await fs.readFile(output)).toString("base64")}`;
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    },
    final: (video, r, stitched) => ({
      review: async () => {
        // Resolve media URL to data URL for review
        const videoData = await mediaDataUrl(video);
        // Use stack's QA model for final review
        const out = await qa(qaModel, videoData, "video", r.brief!, r.sheet?.shots[0]?.text?.copy ?? r.input.goal, r.sheet?.shots.flatMap((s) => (s.text ? [s.text.copy] : [])).join(" "));
        return { score: out.data.score, notes: out.data.notes };
      },
      loudness: async () => {
        const videoData = await mediaDataUrl(video);
        return loudness(videoData);
      },
      ocr: async () => {
        const videoData = await mediaDataUrl(video);
        const cues: CopyCue[] = (r.sheet?.shots ?? []).flatMap((s) => (s.text ? [{ start: s.start, end: s.end, text: s.text.copy, layer: "overlay" as const }] : []));
        return cues.length ? checkExport(videoData, r.sheet!.aspect, stitched.duration, cues) : [];
      },
      // Captions are not burned into sheet renders yet, so there is nothing to time against the voice.
      sync: async () => null,
      patternReview: r.sheet?.patternId === "confession_loop" ? async () => {
        const videoData = await mediaDataUrl(video);
        const { confessionLoopReviewPrompt } = await import("@/lib/qa/pattern-review");
        const prompt = confessionLoopReviewPrompt(r.sheet!);
        const result = await qa(qaModel, videoData, "video", r.brief!, prompt);
        return { score: result.data.score, notes: result.data.notes };
      } : undefined,
    }),
    clipCache: cacheStore("sheet-clips"),
    judgeCache: cacheStore("sheet-judge"),
    stackModels,
  };
}

