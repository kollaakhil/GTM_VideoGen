import type { Stage } from "./registry/types";
import { CATALOG, STAGE_DEFAULTS } from "./registry";
import { migrateModels } from "./registry/migrations";

/**
 * A version stack: one complete set of model choices for a video run.
 * The Versions feature renders 2 to 4 stacks side-by-side so the user can pick the winner.
 */
export interface VersionStack {
  id: string;
  label: string;
  description: string;
  models: Partial<Record<Stage, string>>;
  estimatedCostUsd: number;
}

/**
 * Preset stacks: pre-configured model combinations that show off different approaches.
 * - "premium": Top closed models (Opus, Veo, Kling)
 * - "open": Open-source models from HF/fal
 * - "blender": Blender-heavy for product shots
 * - "experimental": Latest experimental models
 */
export const PRESET_STACKS: VersionStack[] = [
  {
    id: "premium",
    label: "Premium (Top closed)",
    description: "Best closed models: Claude Opus, Veo 3.1, Kling 4.0, ElevenLabs",
    models: {
      research: "anthropic/claude-opus-5.5",
      script: "google/gemini-4-carbon",
      enhancer: "anthropic/claude-sonnet-5.5",
      image: "google/gemini-nano-banana-2.1",
      video: "kling/v4/image-to-video",
      voice: "elevenlabs/tts/eleven-v4",
      music: "elevenlabs/music/v2.5",
      sfx: "mirelo-ai/sfx2.0/text-to-audio",
      qa: "google/gemini-3.8-flash",
      asset3d: "speridlabs/idol/max",
    },
    estimatedCostUsd: 0,
  },
  {
    id: "open",
    label: "Open source",
    description: "Open weights: Qwen, DeepSeek, Flux, Wan, Chatterbox",
    models: {
      research: "qwen/qwen3.8-27b",
      script: "qwen/qwen3.8-27b",
      enhancer: "deepseek/deepseek-v4-pro",
      image: "blackforestlabs/flux-3/text-to-image",
      video: "alibaba/wan-3.0/image-to-video",
      voice: "fal-ai/chatterbox/text-to-speech",
      music: "fal-ai/ace-step",
      sfx: "mirelo-ai/sfx2.0/text-to-audio",
      qa: "google/gemini-3.8-flash",
      asset3d: "speridlabs/idol/max/turbo",
    },
    estimatedCostUsd: 0,
  },
  {
    id: "blender",
    label: "Blender-heavy",
    description: "Product shots through Blender, minimal AI video",
    models: {
      research: "anthropic/claude-sonnet-5.5",
      script: "google/gemini-4-carbon",
      enhancer: "anthropic/claude-sonnet-5.5",
      image: "google/gemini-nano-banana-2.1",
      video: "auto",
      voice: "fal-ai/elevenlabs/tts/eleven-v3",
      music: "elevenlabs/music/v2.5",
      sfx: "mirelo-ai/sfx2.0/text-to-audio",
      qa: "google/gemini-3.8-flash",
      asset3d: "speridlabs/idol/max",
    },
    estimatedCostUsd: 0,
  },
  {
    id: "experimental",
    label: "Experimental",
    description: "Latest models: Gemini 4 Neon, Veo 3.1, Flux",
    models: {
      research: "google/gemini-4-neon",
      script: "google/gemini-4-carbon",
      enhancer: "google/gemini-4-neon",
      image: "google/gemini-nano-banana-2.1",
      video: "fal-ai/veo3.1/image-to-video",
      voice: "elevenlabs/tts/eleven-v4",
      music: "elevenlabs/music/v2.5",
      sfx: "elevenlabs/sound-effects/v3",
      qa: "google/gemini-4-carbon",
      asset3d: "speridlabs/idol/max",
    },
    estimatedCostUsd: 0,
  },
];

/**
 * Validates that all models in a stack exist in the catalog and are assigned to the correct stage.
 * Returns an array of validation errors, empty if valid.
 */
export function validateStack(stack: VersionStack): string[] {
  const errors: string[] = [];
  for (const [stage, modelId] of Object.entries(stack.models)) {
    if (modelId === "auto") continue;
    const model = CATALOG.find((m) => m.id === modelId);
    if (!model) {
      errors.push(`Model ${modelId} not found in catalog`);
      continue;
    }
    if (!model.stages.includes(stage as Stage)) {
      errors.push(`Model ${modelId} cannot serve stage ${stage}`);
    }
  }
  return errors;
}

/**
 * Estimates the cost of a stack for one video run.
 * Uses registry cost estimates per stage (rough: seconds for video, tokens for text, etc.).
 */
export function estimateStackCost(stack: VersionStack, o: { shots?: number; targetSec?: number } = {}): number {
  const shots = o.shots ?? 6;
  const targetSec = o.targetSec ?? 20;
  let total = 0;

  for (const [stage, modelId] of Object.entries(stack.models)) {
    if (modelId === "auto") continue;
    const model = CATALOG.find((m) => m.id === modelId);
    if (!model) continue;

    // Rough cost per stage
    const cost = model.cost;
    switch (cost.unit) {
      case "per_sec":
        // Video: targetSec per shot * shots
        total += cost.usd * (targetSec / shots) * shots;
        break;
      case "per_image":
        // Image: 1 keyframe per shot
        total += cost.usd * shots;
        break;
      case "per_1k_chars":
        // Voice: ~150 chars per shot
        total += cost.usd * (150 * shots) / 1000;
        break;
      case "per_clip":
        // Music/SFX
        total += cost.usd;
        break;
      case "per_mtok":
        // Text models: rough 2k in / 1k out
        total += (cost.usd * 2 + (cost.usdOut ?? cost.usd) * 1) / 1000;
        break;
      case "per_asset":
        // 3D asset
        total += cost.usd;
        break;
      case "free":
      case "credits":
        // Free or Higgsfield credits
        break;
    }
  }

  return +total.toFixed(3);
}

/**
 * Refreshes preset stacks with their current cost estimates.
 */
export function getPresetsWithCosts(o: { shots?: number; targetSec?: number } = {}): VersionStack[] {
  return PRESET_STACKS.map((stack) => ({
    ...stack,
    estimatedCostUsd: estimateStackCost(stack, o),
  }));
}

/**
 * Creates a custom stack from user-selected models (from the model picker).
 */
export function createCustomStack(
  label: string,
  models: Partial<Record<Stage, string>>,
  o: { shots?: number; targetSec?: number } = {}
): VersionStack {
  const stack: VersionStack = {
    id: `custom-${Date.now()}`,
    label,
    description: "Custom model selection",
    models,
    estimatedCostUsd: 0,
  };
  stack.estimatedCostUsd = estimateStackCost(stack, o);
  return stack;
}

/**
 * Fills in missing stages with defaults.
 */
export function normalizeStack(stack: VersionStack): VersionStack {
  const models = { ...stack.models };
  for (const stage of Object.keys(STAGE_DEFAULTS) as Stage[]) {
    if (!models[stage]) {
      models[stage] = STAGE_DEFAULTS[stage];
    }
  }
  return { ...stack, models };
}

/**
 * Migrates a version stack's models from deprecated IDs to their live replacements.
 */
export function migrateStack(stack: VersionStack): VersionStack {
  return {
    ...stack,
    models: migrateModels(stack.models),
  };
}
