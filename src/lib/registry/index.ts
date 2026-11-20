import { CATALOG } from "./catalog";
import type { ModelEntry, Stage } from "./types";

export * from "./types";
export { CATALOG, VERIFIED_AT } from "./catalog";

export const AUTO = "auto";

export const STAGES: { id: Stage; label: string; hint: string }[] = [
  { id: "research", label: "Research & brief", hint: "Reads the brand, the market and writes the creative brief." },
  { id: "script", label: "Script", hint: "Writes and repairs the spoken lines." },
  { id: "enhancer", label: "Shot-sheet enhancer", hint: "Turns the script into camera, lens, timing and lighting." },
  { id: "image", label: "Images & keyframes", hint: "First frames and still creatives." },
  { id: "video", label: "Video (per shot)", hint: "Clips. Auto sends product shots to Blender, text to Remotion, people to the best video model." },
  { id: "voice", label: "Voiceover", hint: "Speech for the script." },
  { id: "music", label: "Music", hint: "The bed under the cut." },
  { id: "sfx", label: "Sound effects", hint: "Foley on every action." },
  { id: "qa", label: "QA judge", hint: "Scores previews and the final." },
  { id: "asset3d", label: "Product 3D asset", hint: "Product photo in, textured GLB out. Blender imports the real product mesh for product and hero shots. Only for irregular products (shoes, toys, gadgets); cans, bottles and boxes use a free Blender primitive. Auto uses Idol Max for finals and Turbo for previews." },
];

const BY_ID = new Map(CATALOG.map((e) => [e.id, e]));

export const getModel = (id: string): ModelEntry | undefined => BY_ID.get(id);

/** Every model that can serve a stage. `runnable: false` entries are included so pickers can show them disabled. */
export function modelsFor(stage: Stage, o: { runnableOnly?: boolean } = {}): ModelEntry[] {
  return CATALOG.filter((e) => e.stages.includes(stage) && (!o.runnableOnly || e.runnable));
}

/**
 * Best default per stage. The choices that already won an A/B in this repo stay (Eleven v3 voice, Stable Audio 2.5 music,
 * Seedance 2.0 Fast previews, free local foley); each can be overridden with STAGE_MODEL_<STAGE> in the environment.
 */
export const STAGE_DEFAULTS: Record<Stage, string> = {
  research: "anthropic/claude-sonnet-5.5",
  script: "google/gemini-4-carbon",
  enhancer: "anthropic/claude-sonnet-5.5",
  image: "google/gemini-nano-banana-2.1",
  video: "bytedance/seedance-2.0-fast",
  voice: "fal-ai/elevenlabs/tts/eleven-v3",
  music: "elevenlabs/music/v2.5",
  sfx: "mirelo-ai/sfx2.0/text-to-audio",
  qa: "google/gemini-3.8-flash",
  asset3d: "speridlabs/idol/max",
};

export function defaultFor(stage: Stage, env: Record<string, string | undefined> = process.env): string {
  const o = env[`STAGE_MODEL_${stage.toUpperCase()}`];
  return o && getModel(o)?.stages.includes(stage) ? o : STAGE_DEFAULTS[stage];
}

export type Picks = Partial<Record<Stage, string>>;

/** A stage's model for a run: the explicit pick, else the stage default. `auto` resolves per shot (see route.ts). */
export function resolvePick(picks: Picks | undefined, stage: Stage): string {
  const p = picks?.[stage];
  return p && (p === AUTO || getModel(p)?.stages.includes(stage)) ? p : defaultFor(stage);
}

/** Keeps only picks that name a real model for their stage (request bodies and saved runs are untrusted). */
export function sanitizePicks(input: unknown): Picks {
  const out: Picks = {};
  if (!input || typeof input !== "object") return out;
  for (const [stage, id] of Object.entries(input as Record<string, unknown>)) {
    if (!STAGES.some((s) => s.id === stage) || typeof id !== "string") continue;
    if (id === AUTO ? stage === "video" || stage === "asset3d" : getModel(id)?.stages.includes(stage as Stage)) out[stage as Stage] = id;
  }
  return out;
}

/** Rough USD for using a model once: seconds for video, characters for voice, tokens for text (≈2k in / 1k out). */
export function estimateUsd(e: ModelEntry, o: { seconds?: number; chars?: number; images?: number } = {}): number {
  const c = e.cost;
  switch (c.unit) {
    case "per_sec": return +(c.usd * (o.seconds ?? 5)).toFixed(3);
    case "per_1k_chars": return +(c.usd * ((o.chars ?? 600) / 1000)).toFixed(3);
    case "per_image": return +(c.usd * (o.images ?? 1)).toFixed(3);
    case "per_mtok": return +((c.usd * 2000 + (c.usdOut ?? c.usd) * 1000) / 1e6).toFixed(4);
    case "per_clip":
    case "per_asset": return c.usd;
    default: return 0;
  }
}
