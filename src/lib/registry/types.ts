/**
 * Model registry types. This file is type-only so `scripts/verify-models.mjs` can load the catalog with Node's built-in
 * TypeScript stripping (no bundler): nothing in `catalog.ts`, `fal-knobs.ts` or `fal-snapshot.ts` may use `@/` aliases
 * or non-erasable syntax (enums, parameter properties).
 */
export type Stage = "research" | "script" | "enhancer" | "image" | "video" | "voice" | "music" | "sfx" | "qa" | "asset3d";

export type RegProvider = "openrouter" | "fal" | "higgsfield" | "hfmcp" | "huggingface" | "local-blender" | "local-remotion" | "local-synth";

/** Prompt-style families: the compiler in `prompt.ts` keys off this. */
export type Family =
  | "veo" | "kling" | "seedance" | "wan" | "ltx" | "hunyuan" | "longcat" | "minimax" | "grok" | "omni" | "pixverse" | "vidu" | "luma" | "runway" | "flux-video" | "higgsfield-video" | "generic-video"
  | "flux" | "nano-banana" | "gpt-image" | "seedream" | "ideogram" | "recraft" | "qwen-image" | "z-image" | "hunyuan-image" | "gpt-image-or" | "generic-image"
  | "eleven" | "gemini-tts" | "minimax-speech" | "chatterbox" | "qwen-tts" | "inworld" | "seed-audio" | "text2speech"
  | "stable-audio" | "eleven-music" | "lyria" | "minimax-music" | "ace-step" | "eleven-sfx" | "generic-audio"
  | "claude" | "gpt" | "gemini" | "open-llm"
  | "blender" | "remotion" | "synth" | "mesh3d" | "world";

export interface Caps {
  i2v?: boolean;
  t2v?: boolean;
  firstLast?: boolean;
  minSeconds?: number;
  maxSeconds?: number;
  /** Highest resolution the model serves ("1080p", "4k", "1K"…). */
  resolution?: string;
  /** Video models that generate their own soundtrack / voice. */
  audioOut?: boolean;
  openSource?: boolean;
  /** A generative world / interactive scene model rather than a clip model. */
  worldModel?: boolean;
  /** Produces a 3D mesh (GLB etc.) that Blender can use. */
  threeD?: boolean;
  /** Accepts images (QA judges, edit models). */
  vision?: boolean;
  /** Accepts reference images when generating (image edit / multi-ref). */
  refs?: boolean;
  license?: string;
  /** Open weights repository on Hugging Face (checked by verify-models). */
  hfRepo?: string;
}

export type CostUnit = "per_sec" | "per_image" | "per_clip" | "per_1k_chars" | "per_mtok" | "per_asset" | "credits" | "free";

export interface Cost {
  unit: CostUnit;
  /** USD per unit (per input Mtok for `per_mtok`). */
  usd: number;
  /** USD per output Mtok, for `per_mtok`. */
  usdOut?: number;
  /** "live" = read from the provider's own list; "estimate" = rough, refresh with the provider's price page. */
  basis: "live" | "estimate" | "free";
}

export type VerifySource = "openrouter" | "openrouter-video" | "fal" | "huggingface-router" | "higgsfield-mcp" | "local" | "unverified";

export interface Verify {
  source: VerifySource;
  /** Id to look up when it differs from the entry id. */
  lookup?: string;
  /** Why an entry is unverified, or what the check could not cover. */
  note?: string;
}

export interface ModelEntry {
  id: string;
  label: string;
  provider: RegProvider;
  stages: Stage[];
  family: Family;
  caps: Caps;
  cost: Cost;
  /** The env var that must be set for this model to be usable; null when the provider needs none. */
  env: string | null;
  verify: Verify;
  /** False when the entry is catalogued (so the user can see it exists) but no adapter can call it yet. */
  runnable: boolean;
  /** fal only: companion endpoints (text-to-video when `id` is the image-to-video endpoint, or the image edit endpoint). */
  fal?: { t2v?: string; edit?: string };
  note?: string;
}
