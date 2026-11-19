import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { paid } from "../render/cost-meter";
import { chatJSON, downloadAsDataUrl, falRun, generateImage, generateVideo, musicBed, MUSIC_MODEL, speakable, voiceover, VOICE_MODEL, type Part, type Usage, type VideoOpts } from "../ai";
import { buildFalBody } from "./fal-knobs";
import { FAL_KNOBS } from "./fal-snapshot";
import { estimateUsd, getModel } from "./index";
import { readiness } from "./ready";
import { sfxFile, type SfxKind } from "../sfx";
import type { ModelEntry, Stage } from "./types";

/**
 * One adapter interface per stage, behind `runStage`. Text, image and video reuse the existing provider code in
 * `ai.ts` (which now routes by registry provider); voice, music, sound effects and 3D go through fal's derived request
 * knobs. Every call checks that the model exists, serves the stage, has an adapter and has its key, with an error the
 * Studio can show as is.
 */
export type StageCall =
  | { stage: "research" | "script" | "enhancer" | "qa"; model: string; system: string; user: string | Part[] }
  | { stage: "image"; model: string; prompt: string; refs?: string[] }
  | { stage: "video"; model: string; prompt: string; opts?: VideoOpts }
  | { stage: "voice"; model: string; text: string; voice?: string; sayAs?: { brand?: string; pronunciation?: string } }
  | { stage: "music"; model: string; prompt: string; seconds: number }
  | { stage: "sfx"; model: string; prompt: string; seconds: number }
  | { stage: "asset3d"; model: string; prompt?: string; imageUrl?: string };

export type StageResult = { data?: unknown; url?: string; usage: Usage };

export class StageError extends Error {
  constructor(message: string, readonly code: "unknown_model" | "wrong_stage" | "not_runnable" | "not_connected") {
    super(message);
    this.name = "StageError";
  }
}

/** Throws a clear StageError unless `model` can serve `stage` right now. */
export function assertCallable(stage: Stage, model: string, env: Record<string, string | undefined> = process.env): ModelEntry {
  const e = getModel(model);
  if (!e) throw new StageError(`${model} is not in the model registry`, "unknown_model");
  if (!e.stages.includes(stage)) throw new StageError(`${e.label} cannot be used for ${stage}`, "wrong_stage");
  const r = readiness(e, env);
  if (!r.ready) throw new StageError(`${e.label} is not available: ${r.reason}`, e.runnable ? "not_connected" : "not_runnable");
  return e;
}

const AUDIO_KEYS = ["audio", "audio_file", "audio_url", "output", "file"];
const MESH_KEYS = ["game_glb", "model_mesh", "glb", "model_glb", "mesh", "model_urls", "model", "output"];

/** First URL found under the usual keys of a fal response, falling back to a deep search by file extension. */
export function pickUrl(out: unknown, keys: string[], ext: RegExp): string | undefined {
  const o = (out ?? {}) as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
    if (v && typeof v === "object") {
      const u = (v as { url?: unknown }).url;
      if (typeof u === "string") return u;
      const inner = pickUrl(v, Object.keys(v as object), ext);
      if (inner) return inner;
    }
  }
  const stack: unknown[] = [out];
  while (stack.length) {
    const cur = stack.pop();
    if (typeof cur === "string" && /^https?:\/\//.test(cur) && ext.test(cur.split("?")[0])) return cur;
    if (cur && typeof cur === "object") stack.push(...Object.values(cur as object));
  }
  return undefined;
}

const kn = (endpoint: string) => {
  const k = FAL_KNOBS[endpoint];
  if (!k) throw new Error(`No request schema for ${endpoint}. Run node scripts/verify-models.mjs --write-snapshot`);
  return k;
};

const ELEVEN_VOICES = ["Rachel", "Aria", "Sarah", "Laura", "Charlotte", "Jessica", "Lily", "Roger", "Charlie", "George", "Callum", "Liam", "Will", "Eric", "Chris", "Brian", "Daniel"];

async function voiceStage(e: ModelEntry, text: string, voice?: string, sayAs?: { brand?: string; pronunciation?: string }): Promise<StageResult> {
  if (e.id === VOICE_MODEL) return voiceover(text, voice, sayAs);
  const t = speakable(text, sayAs);
  const body: Record<string, unknown> = buildFalBody(kn(e.id), t);
  if (e.family === "eleven") Object.assign(body, { voice: ELEVEN_VOICES.includes(voice ?? "") ? voice : "Rachel", stability: 0.5 });
  if (e.family === "gemini-tts" && voice) body.voice = voice;
  // MiniMax answers with hex audio unless asked for a URL.
  if (e.family === "minimax-speech") body.output_format = "url";
  const est = estimateUsd(e, { chars: text.length });
  const { out } = await paid(`voice:${e.id}`, est, async () => ({ out: await falRun<unknown>(e.id, body), usage: { costUsd: est } }));
  const url = pickUrl(out, AUDIO_KEYS, /\.(mp3|wav|ogg|opus|flac|m4a|aac)$/i);
  if (!url) throw new Error(`${e.label} returned no audio`);
  return { url: await downloadAsDataUrl(url), usage: { costUsd: est } };
}

const FOLEY: [RegExp, SfxKind][] = [[/pour|stream|liquid|fill/i, "pour"], [/fizz|bubbl|carbon|sparkl/i, "fizz"], [/pop|crack|snap|click|tab/i, "pop"], [/clink|ice|glass|ting/i, "clink"], [/.*/, "whoosh"]];

/** Free local foley: the app's own FFmpeg-synthesised sounds (src/lib/sfx.ts), picked by what the prompt describes. */
async function localFoley(prompt: string): Promise<StageResult> {
  const kind = (FOLEY.find(([re]) => re.test(prompt)) as [RegExp, SfxKind])[1];
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "foley-"));
  try {
    const file = await sfxFile(kind, dir);
    return { url: `data:audio/wav;base64,${(await fs.readFile(file)).toString("base64")}`, usage: { costUsd: 0 } };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function audioStage(e: ModelEntry, prompt: string, seconds: number): Promise<StageResult> {
  if (e.provider === "local-synth") return localFoley(prompt);
  if (e.id === MUSIC_MODEL) return musicBed(prompt, seconds);
  const max = e.caps.maxSeconds ?? 60;
  const body: Record<string, unknown> = buildFalBody(kn(e.id), prompt, { seconds: Math.max(2, Math.min(max, Math.ceil(seconds))) });
  if (e.family === "eleven-music") body.force_instrumental = true;
  if (e.family === "ace-step") body.lyrics = "[instrumental]";
  const est = estimateUsd(e);
  const { out } = await paid(`audio:${e.id}`, est, async () => ({ out: await falRun<unknown>(e.id, body), usage: { costUsd: est } }));
  const url = pickUrl(out, AUDIO_KEYS, /\.(mp3|wav|ogg|opus|flac|m4a|aac)$/i);
  if (!url) throw new Error(`${e.label} returned no audio`);
  return { url: await downloadAsDataUrl(url), usage: { costUsd: est } };
}

async function asset3dStage(e: ModelEntry, prompt?: string, imageUrl?: string): Promise<StageResult> {
  const k = kn(e.id);
  if ((k.image || k.imageArray) && !imageUrl && !prompt) throw new Error(`${e.label} needs a product image`);
  if (!k.image && !k.imageArray && !prompt) throw new Error(`${e.label} needs a text prompt`);
  const est = estimateUsd(e);
  const { out } = await paid(`3d:${e.id}`, est, async () => ({ out: await falRun<unknown>(e.id, buildFalBody(k, prompt ?? "", { firstFrame: imageUrl, refs: imageUrl ? [imageUrl] : undefined })), usage: { costUsd: est } }));
  const url = pickUrl(out, MESH_KEYS, /\.(glb|gltf|obj|fbx|usdz)$/i);
  if (!url) throw new Error(`${e.label} returned no 3D file`);
  return { url, usage: { costUsd: est } };
}

/** Runs one stage on one registry model. */
export async function runStage(call: StageCall, env: Record<string, string | undefined> = process.env): Promise<StageResult> {
  const e = assertCallable(call.stage, call.model, env);
  switch (call.stage) {
    case "research":
    case "script":
    case "enhancer":
    case "qa":
      return chatJSON<unknown>(call.model, call.system, call.user);
    case "image":
      return generateImage(call.model, call.prompt, call.refs);
    case "video":
      return generateVideo(call.model, call.prompt, call.opts);
    case "voice":
      return voiceStage(e, call.text, call.voice, call.sayAs);
    case "music":
    case "sfx":
      return audioStage(e, call.prompt, call.seconds);
    case "asset3d":
      return asset3dStage(e, call.prompt, call.imageUrl);
  }
}
