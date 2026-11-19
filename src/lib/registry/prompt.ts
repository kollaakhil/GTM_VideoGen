import { getModel } from "./index";
import type { Family, ModelEntry } from "./types";

/**
 * Per-model prompt compiler. A shot-sheet row is one structured record (camera, lens, action, lighting, timing…); each
 * model family reads a different prompt style best, so the row is compiled per model instead of pasted as one string.
 * Rules that hold for every video family (PLAYBOOK 13.x): copy is never painted by an AI video model (Remotion or the
 * typesetter owns it), negations go in the negative field where one exists and are phrased as positives otherwise, and
 * a labelled product stays upright (the label lock lives in the row's `continuity`).
 */
export interface CompileShot {
  shotType?: string;
  framing?: string;
  angle?: string;
  move?: string;
  lensMm?: number;
  subject?: string;
  action?: string;
  setting?: string;
  lighting?: string;
  /** Timed motion beats inside the shot, in order. */
  beats?: string[];
  seconds?: number;
  /** On-screen copy; only text-capable image models get it, video prompts never do. */
  text?: string;
  textPlacement?: string;
  sfx?: string;
  music?: string;
  /** Things to keep out; sent as a negative prompt where supported. */
  negative?: string[];
  continuity?: string[];
  productFraming?: string;
  /** The look the whole sheet shares ("black void, light from the glowing parts"). */
  palette?: string;
}

/** The two shapes in the repo: builder A's SheetShot and builder C's ShotRow (both structurally accepted). */
export interface SheetShotLike {
  shotType?: string; framing?: string; camera?: { angle?: string; move?: string; lensMm?: number };
  subject?: string; action?: string; lighting?: string; text?: { copy?: string; placement?: string } | null;
  audio?: { sfx?: string | null; music?: string | null }; start?: number; end?: number; prompt?: string;
}
export interface RowLike { action?: string; camera?: string; lensMm?: number; lighting?: string; onScreen?: string; sound?: string; seconds?: number }

export function shotFrom(x: SheetShotLike | RowLike, extra: Partial<CompileShot> = {}): CompileShot {
  const s = x as SheetShotLike & RowLike;
  const cam = (x as SheetShotLike).camera;
  if (cam && typeof cam === "object") {
    return { shotType: s.shotType, framing: s.framing, angle: cam.angle, move: cam.move, lensMm: cam.lensMm, subject: s.subject, action: s.action, lighting: s.lighting, text: s.text?.copy, textPlacement: s.text?.placement, sfx: s.audio?.sfx ?? undefined, music: s.audio?.music ?? undefined, seconds: typeof s.start === "number" && typeof s.end === "number" ? +(s.end - s.start).toFixed(2) : undefined, ...extra };
  }
  return { action: s.action, move: typeof s.camera === "string" ? s.camera : undefined, lensMm: s.lensMm, lighting: s.lighting, text: s.onScreen, sfx: s.sound, seconds: s.seconds, ...extra };
}

export interface Compiled {
  prompt: string;
  /** For models that take a separate negative prompt. */
  negative?: string;
  /** Anything the compiler changed or dropped on purpose, for the editor to show. */
  notes: string[];
}

const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim().replace(/[.;,\s]+$/, "");
const sentence = (s: string | undefined) => { const t = clean(s); return t ? `${t[0].toUpperCase()}${t.slice(1)}.` : ""; };
const join = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(" ");
const lens = (s: CompileShot) => (s.lensMm ? `${Math.round(s.lensMm)}mm lens` : "");
const camLine = (s: CompileShot) => [clean(s.shotType), clean(s.angle), clean(s.move), lens(s)].filter(Boolean).join(", ");
const timeCoded = (s: CompileShot) => {
  const beats = s.beats?.filter(Boolean) ?? [];
  if (!beats.length || !s.seconds) return "";
  const step = s.seconds / beats.length;
  return beats.map((b, i) => `${+(i * step).toFixed(1)}-${+((i + 1) * step).toFixed(1)}s: ${clean(b)}`).join(" ");
};
const action = (s: CompileShot) => clean(s.beats?.length ? s.beats.join(", then ") : s.action);
const locks = (s: CompileShot) => [clean(s.productFraming), ...(s.continuity ?? []).map(clean)].filter(Boolean);

const HAILUO_MOVES: [RegExp, string][] = [
  [/push-?\s?in|dolly in|move in|creep/i, "[Push in]"], [/pull-?\s?out|dolly out|pull back/i, "[Pull out]"], [/pan left/i, "[Pan left]"], [/pan right/i, "[Pan right]"],
  [/tilt up/i, "[Tilt up]"], [/tilt down/i, "[Tilt down]"], [/truck left|track(ing)? left/i, "[Truck left]"], [/truck right|track(ing)? right/i, "[Truck right]"],
  [/zoom in/i, "[Zoom in]"], [/zoom out/i, "[Zoom out]"], [/pedestal up|crane up|rise/i, "[Pedestal up]"], [/pedestal down|crane down/i, "[Pedestal down]"],
  [/handheld|shake/i, "[Shake]"], [/orbit|arc|around/i, "[Tracking shot]"], [/static|locked|still/i, "[Static shot]"],
];
export const hailuoCamera = (move: string | undefined) => HAILUO_MOVES.filter(([re]) => re.test(move ?? "")).slice(0, 3).map(([, c]) => c).join("") || "[Static shot]";

const VIDEO_NEGATIVE = ["on-screen text, captions, watermarks or logos", "warped or extra fingers", "morphing or duplicate products", "flicker", "sudden zooms"];
const negFor = (s: CompileShot) => [...new Set([...(s.negative ?? []).map(clean), ...VIDEO_NEGATIVE])].filter(Boolean).slice(0, 10).join(", ");

type VideoFn = (s: CompileShot, audio: boolean) => string;

const VIDEO: Record<string, VideoFn> = {
  // Veo: cinematography first, then subject, action, context, style; audio cues in their own sentence.
  veo: (s, a) => join(`Cinematography: ${camLine(s)}.`, sentence(`Subject: ${s.subject}`), sentence(`Action: ${action(s)}`), sentence(`Context: ${s.setting ?? s.framing}`), sentence(`Lighting and mood: ${s.lighting}${s.palette ? `, ${s.palette}` : ""}`), ...locks(s).map(sentence), a && s.sfx ? sentence(`Audio: ${s.sfx}, no dialogue`) : ""),
  // Kling: subject + motion, then an explicit camera line; short and concrete.
  kling: (s) => join(sentence(`${s.subject}. ${action(s)}`), sentence(`Camera: ${[s.move, s.angle, lens(s)].filter(Boolean).join(", ")}`), sentence(`Lighting: ${s.lighting}`), sentence(s.setting), ...locks(s).map(sentence)),
  // Seedance: time-coded beats when there are several, subject-action-camera-style otherwise.
  seedance: (s) => join(sentence(s.subject), timeCoded(s) || sentence(action(s)), sentence(`Camera: ${camLine(s)}`), sentence(`Light: ${s.lighting}`), sentence(s.setting), ...locks(s).map(sentence)),
  // Wan: dense scene description, then shot size / angle / lens / light as aesthetic controls.
  wan: (s) => join(sentence(`${s.subject}, ${action(s)}`), sentence(s.setting), sentence(`${s.lighting}, ${camLine(s)}`), "Cinematic, high detail, natural motion.", ...locks(s).map(sentence)),
  // LTX: one flowing present-tense paragraph, chronological, camera and light explicit, then the sound.
  ltx: (s, a) => join(sentence(`${s.shotType ? `${clean(s.shotType)}: ` : ""}${s.subject}`), sentence(action(s)), sentence(s.setting), sentence(`The camera ${clean(s.move) || "holds steady"}${s.angle ? `, ${clean(s.angle)}` : ""}${s.lensMm ? `, ${Math.round(s.lensMm)}mm lens` : ""}`), sentence(`The light: ${s.lighting}`), ...locks(s).map(sentence), a && s.sfx ? sentence(`The sound: ${s.sfx}`) : ""),
  hunyuan: (s) => join(sentence(s.subject), sentence(action(s)), sentence(`Scene: ${s.setting}`), sentence(`Camera: ${camLine(s)}`), sentence(`Lighting: ${s.lighting}`), ...locks(s).map(sentence)),
  longcat: (s) => join(sentence(s.subject), sentence(action(s)), sentence(s.setting), sentence(`${camLine(s)}`), sentence(s.lighting), ...locks(s).map(sentence)),
  // Hailuo/MiniMax: bracketed camera commands lead the prompt.
  minimax: (s) => join(hailuoCamera(s.move), sentence(`${s.subject}, ${action(s)}`), sentence(s.setting), sentence(s.lighting), ...locks(s).map(sentence)),
  grok: (s) => join(sentence(`${s.subject}, ${action(s)}`), sentence(`${clean(s.move)}, ${lens(s)}`), sentence(s.lighting), ...locks(s).map(sentence)),
  omni: (s, a) => join(sentence(`${camLine(s)}. ${s.subject}`), sentence(action(s)), sentence(s.setting), sentence(s.lighting), ...locks(s).map(sentence), a && s.sfx ? sentence(`Audio: ${s.sfx}`) : ""),
  pixverse: (s) => join(sentence(`${s.subject}, ${action(s)}`), sentence(`${clean(s.move)}`), sentence(s.setting), sentence(s.lighting), ...locks(s).map(sentence)),
  vidu: (s) => join(sentence(`${s.subject}, ${action(s)}`), sentence(`${clean(s.move)}`), sentence(s.setting), sentence(s.lighting), ...locks(s).map(sentence)),
  luma: (s) => join(sentence(`${camLine(s)}: ${s.subject}`), sentence(action(s)), sentence(s.setting), sentence(s.lighting), ...locks(s).map(sentence)),
  runway: (s) => join(sentence(`${clean(s.move)}`), sentence(`${s.subject}, ${action(s)}`), sentence(s.lighting), ...locks(s).map(sentence)),
  "flux-video": (s) => join(sentence(`${camLine(s)}: ${s.subject}`), sentence(action(s)), sentence(s.setting), sentence(s.lighting), ...locks(s).map(sentence)),
  "higgsfield-video": (s) => join(sentence(`${camLine(s)}. ${s.subject}`), sentence(action(s)), sentence(s.setting), sentence(s.lighting), ...locks(s).map(sentence)),
  "generic-video": (s) => join(sentence(`${s.subject}, ${action(s)}`), sentence(`Camera: ${camLine(s)}`), sentence(s.lighting), sentence(s.setting), ...locks(s).map(sentence)),
};

/** Video families whose API takes a negative prompt (checked against fal's schemas on 2026-11-19). */
const NEGATIVE_FIELD = new Set<Family>(["veo", "kling", "wan", "ltx", "longcat", "pixverse"]);

export function compileVideoPrompt(model: ModelEntry | string, shot: CompileShot): Compiled {
  const e = typeof model === "string" ? getModel(model) : model;
  const family = e?.family ?? "generic-video";
  const notes: string[] = [];
  const audioOut = !!e?.caps.audioOut;
  const fn = VIDEO[family] ?? VIDEO["generic-video"];
  const prompt = clean(fn(shot, audioOut));
  if (shot.text) notes.push(`on-screen copy "${clean(shot.text).slice(0, 40)}" left out: video models misspell it, Remotion/typesetter adds it`);
  if (shot.sfx && !audioOut) notes.push("sfx not in the prompt: this model makes no audio, foley is mixed in the edit");
  const negative = NEGATIVE_FIELD.has(family) ? negFor(shot) : undefined;
  if (!negative) notes.push("no negative-prompt field: negations are written as positives (label upright, product single, clean frame)");
  return { prompt: prompt.slice(0, 2500), negative, notes };
}

const IMAGE: Record<string, (s: CompileShot, o: ImageOpts) => string> = {
  // Nano Banana: conversational, full sentences; references are described as instructions.
  "nano-banana": (s, o) => join(o.refs ? "Using the reference image(s) of the product, keep the packaging and label exactly as shown." : "", sentence(`A photorealistic ${clean(s.shotType) || "photo"} of ${s.subject}, ${clean(s.action)}`), sentence(`Shot at ${clean(s.angle)} on a ${lens(s) || "50mm lens"}`), sentence(`Lighting: ${s.lighting}`), sentence(s.setting), ...locks(s).map(sentence), s.text ? sentence(`Include the exact text "${clean(s.text)}" ${clean(s.textPlacement) || "in the lower third"}`) : ""),
  // GPT Image: labelled sections, text verbatim in quotes, explicit constraints.
  "gpt-image": (s, o) => gptImage(s, o),
  "gpt-image-or": (s, o) => gptImage(s, o),
  flux: (s) => join(sentence(`${clean(s.shotType) || "Photo"} of ${s.subject}, ${clean(s.action)}`), sentence(s.setting), sentence(s.lighting), sentence(`${clean(s.angle)}, ${lens(s)}, shallow depth of field`), ...locks(s).map(sentence), s.text ? sentence(`The text "${clean(s.text)}" is printed ${clean(s.textPlacement) || "lower third"} in clean sans-serif`) : ""),
  ideogram: (s) => join(sentence(`${clean(s.shotType) || "Image"}: ${s.subject}, ${clean(s.action)}`), sentence(s.lighting), sentence(s.setting), s.text ? `Typography: "${clean(s.text)}", ${clean(s.textPlacement) || "lower third"}, bold clean sans-serif, high contrast.` : ""),
  seedream: (s) => join(sentence(`${s.subject}, ${clean(s.action)}`), sentence(s.setting), sentence(s.lighting), sentence(`${camLine(s)}`), ...locks(s).map(sentence), s.text ? sentence(`Text reads "${clean(s.text)}"`) : ""),
  recraft: (s) => join(sentence(`${s.subject}, ${clean(s.action)}`), sentence(s.setting), sentence(s.lighting), s.text ? sentence(`Text: "${clean(s.text)}"`) : ""),
  "qwen-image": (s) => join(sentence(`${s.subject}, ${clean(s.action)}`), sentence(s.setting), sentence(s.lighting), sentence(camLine(s)), s.text ? sentence(`Text "${clean(s.text)}" ${clean(s.textPlacement)}`) : ""),
  "z-image": (s) => join(sentence(`${s.subject}, ${clean(s.action)}`), sentence(s.setting), sentence(s.lighting), sentence(camLine(s)), s.text ? sentence(`Text "${clean(s.text)}"`) : ""),
  "hunyuan-image": (s) => join(sentence(`${s.subject}, ${clean(s.action)}`), sentence(`Scene: ${s.setting}`), sentence(`Lighting: ${s.lighting}`), sentence(`Camera: ${camLine(s)}`), s.text ? sentence(`Text: "${clean(s.text)}"`) : ""),
  "generic-image": (s) => join(sentence(`${s.subject}, ${clean(s.action)}`), sentence(s.setting), sentence(s.lighting), sentence(camLine(s))),
};
export interface ImageOpts { refs?: boolean }

function gptImage(s: CompileShot, o: ImageOpts) {
  const lines = [`Scene: ${clean(s.setting) || clean(s.framing)}`, `Subject: ${clean(s.subject)}, ${clean(s.action)}`, `Camera: ${camLine(s)}`, `Lighting: ${clean(s.lighting)}`];
  if (s.text) lines.push(`Text (verbatim, ${clean(s.textPlacement) || "lower third"}): "${clean(s.text)}"`);
  const c = locks(s);
  lines.push(`Constraints: ${[o.refs ? "match the reference product exactly" : "", ...c, "no extra text", "no watermarks"].filter(Boolean).join("; ")}`);
  return lines.filter((l) => !/: ?$/.test(l)).join("\n");
}

export function compileImagePrompt(model: ModelEntry | string, shot: CompileShot, o: ImageOpts = {}): Compiled {
  const e = typeof model === "string" ? getModel(model) : model;
  const fn = IMAGE[e?.family ?? "generic-image"] ?? IMAGE["generic-image"];
  const notes = shot.text && !["nano-banana", "gpt-image", "gpt-image-or", "flux", "ideogram", "seedream", "recraft", "qwen-image", "z-image", "hunyuan-image"].includes(e?.family ?? "") ? ["this model may misspell copy; prefer the typesetter"] : [];
  return { prompt: clean(fn(shot, o)).slice(0, 3000), notes };
}

export interface AudioBrief { kind: "music" | "sfx"; description: string; bpm?: number; mood?: string; seconds?: number }

/** Music and sound-effect prompts: tag lists for Stable Audio / ACE-Step, plain sentences for ElevenLabs, Lyria, MiniMax. */
export function compileAudioPrompt(model: ModelEntry | string, b: AudioBrief): Compiled {
  const e = typeof model === "string" ? getModel(model) : model;
  const f = e?.family ?? "generic-audio";
  const d = clean(b.description);
  const tagStyle = f === "stable-audio" || f === "ace-step";
  const prompt = tagStyle
    ? [d, b.mood && clean(b.mood), b.bpm ? `${b.bpm} BPM` : "", b.kind === "music" ? "instrumental, no vocals" : "clean, dry, close-mic"].filter(Boolean).join(", ")
    : f === "eleven-sfx" || b.kind === "sfx"
      ? `${d}${b.seconds ? `, about ${Math.round(b.seconds * 10) / 10} seconds` : ""}, clean and dry, no music`
      : `${d}${b.mood ? `, ${clean(b.mood)} mood` : ""}${b.bpm ? `, ${b.bpm} BPM` : ""}. Instrumental only, leave room for a voiceover on top${b.seconds ? `, about ${Math.round(b.seconds)} seconds` : ""}.`;
  return { prompt, notes: [] };
}

/** Voice: the text is sent as written (the caller applies `speakable`); Gemini TTS also takes a delivery instruction. */
export function compileVoicePrompt(model: ModelEntry | string, text: string, style?: string): Compiled {
  const e = typeof model === "string" ? getModel(model) : model;
  const t = clean(text);
  return { prompt: e?.family === "gemini-tts" && style ? `Say in a ${clean(style)} voice: ${t}` : t, notes: [] };
}

export function compilePrompt(model: ModelEntry | string, shot: CompileShot, o: ImageOpts = {}): Compiled {
  const e = typeof model === "string" ? getModel(model) : model;
  return e?.stages.includes("image") && !e.stages.includes("video") ? compileImagePrompt(e, shot, o) : compileVideoPrompt(e ?? "generic", shot);
}
