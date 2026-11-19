import { CATALOG } from "./registry/catalog";
import { providerReady } from "./registry/ready";
import type { ModelEntry, RegProvider } from "./registry/types";

/**
 * Legacy view of the model registry (`src/lib/registry`), kept so existing callers keep working: the four-modality
 * `MODELS` list, `DEFAULTS`, `providerOf` and `providerConfigured`. Models are declared once, in the registry catalog.
 */
export type Modality = "text" | "vision" | "image" | "video";
export type Provider = RegProvider;

export interface ModelOption {
  id: string;
  label: string;
  provider: Provider;
  modality: Modality;
}

const TEXT_STAGES = ["research", "script", "enhancer"] as const;

function modalities(e: ModelEntry): Modality[] {
  if (!e.runnable || e.provider.startsWith("local-")) return [];
  const out: Modality[] = [];
  if (TEXT_STAGES.some((s) => e.stages.includes(s))) out.push("text");
  if (e.stages.includes("qa")) out.push("vision");
  if (e.stages.includes("image")) out.push("image");
  if (e.stages.includes("video")) out.push("video");
  return out;
}

export const MODELS: ModelOption[] = CATALOG.flatMap((e) => modalities(e).map((modality) => ({ id: e.id, label: e.label, provider: e.provider, modality })));

export const DEFAULTS = {
  text: process.env.TEXT_MODEL || "anthropic/claude-sonnet-5.5",
  vision: process.env.VISION_MODEL || "google/gemini-3.8-flash",
  image: process.env.IMAGE_MODEL || "google/gemini-nano-banana-2.1",
  video: process.env.VIDEO_MODEL || "bytedance/seedance-2.0-fast",
};

const BY_ID = new Map(CATALOG.map((e) => [e.id, e]));

export function providerOf(modelId: string): Provider {
  if (modelId.startsWith("higgsfield:")) return "higgsfield";
  if (modelId.startsWith("hfmcp:")) return "hfmcp";
  if (modelId.startsWith("hf:")) return "huggingface";
  return BY_ID.get(modelId)?.provider ?? (modelId.startsWith("fal-ai/") ? "fal" : "openrouter");
}

export function providerConfigured(p: Provider): boolean {
  return providerReady(p);
}
