import { NextResponse } from "next/server";
import { CATALOG } from "@/lib/registry/catalog";
import { PRESET_STACKS } from "@/lib/versions";
import { STAGE_DEFAULTS } from "@/lib/registry";
import type { Stage } from "@/lib/registry/types";

/**
 * Preflight model check API: verifies all referenced models are available.
 * Called by Studio before any spend to catch deprecated/missing models early.
 * 
 * Checks:
 * - Model exists in provider's list or schema
 * - Not deprecated (fal 410 or deprecated message)
 * - Output modality matches role (image role → image output, etc.)
 * 
 * GET /api/preflight/models
 * Returns: { ok: boolean, errors: string[], warnings: string[], checked: number }
 */

// Fallback models from render-deps.ts
const RENDER_DEPS_FALLBACKS = [
  "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video",
  "google/gemini-3.8-flash",
  "mirelo-ai/sfx2.0/text-to-audio",
  "elevenlabs/sound-effects/v3",
  "elevenlabs/music/v2.5",
  "fal-ai/stable-audio-3/medium/text-to-audio",
];

// Stage to expected output modality mapping
const STAGE_MODALITIES: Record<string, string[]> = {
  research: ["text"],
  script: ["text"],
  enhancer: ["text"],
  image: ["image"],
  video: ["video"],
  voice: ["audio"],
  music: ["audio"],
  sfx: ["audio"],
  qa: ["text"],
  asset3d: ["3d", "model"],
};

export async function GET() {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checked = new Set<string>();
  const modelStages = new Map<string, Set<string>>(); // Track which stages use each model

  async function checkFalModel(modelId: string): Promise<{ found: boolean; deprecated: boolean; modalities: string[] }> {
    try {
      // Use schema endpoint for metadata check (no generation)
      const schemaUrl = `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${modelId}`;
      const response = await fetch(schemaUrl, {
        headers: { "user-agent": "gtm-engine-preflight-api" },
      });

      if (response.status === 404) {
        return { found: false, deprecated: false, modalities: [] };
      }

      if (response.status === 410) {
        return { found: true, deprecated: true, modalities: [] };
      }

      if (!response.ok) {
        const text = await response.text();
        if (text.toLowerCase().includes("deprecated") || text.toLowerCase().includes("no longer available")) {
          return { found: true, deprecated: true, modalities: [] };
        }
        return { found: false, deprecated: false, modalities: [] };
      }

      // Infer modality from endpoint path
      const modalities: string[] = [];
      if (modelId.includes("text-to-image") || modelId.includes("image")) modalities.push("image");
      if (modelId.includes("video") || modelId.includes("seedance") || modelId.includes("kling")) modalities.push("video");
      if (modelId.includes("audio") || modelId.includes("sound") || modelId.includes("music") || modelId.includes("tts")) modalities.push("audio");
      if (modelId.includes("3d")) modalities.push("3d");
      if (modalities.length === 0) modalities.push("text");

      return { found: true, deprecated: false, modalities };
    } catch (error) {
      warnings.push(`${modelId}: fal check failed: ${error instanceof Error ? error.message : String(error)}`);
      return { found: false, deprecated: false, modalities: [] };
    }
  }

  async function checkOpenRouterModel(modelId: string): Promise<{ found: boolean; deprecated: boolean; modalities: string[] }> {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { "user-agent": "gtm-engine-preflight-api" },
      });

      if (!response.ok) {
        warnings.push(`${modelId}: Could not fetch OpenRouter models list (${response.status})`);
        return { found: false, deprecated: false, modalities: [] };
      }

      const data = (await response.json()) as { data?: Array<{ id: string; architecture?: { output_modalities?: string[] } }> };
      const model = data.data?.find((m) => m.id === modelId);

      if (!model) {
        return { found: false, deprecated: false, modalities: [] };
      }

      const modalities = model.architecture?.output_modalities || ["text"];
      return { found: true, deprecated: false, modalities };
    } catch (error) {
      warnings.push(`${modelId}: OpenRouter check failed: ${error instanceof Error ? error.message : String(error)}`);
      return { found: false, deprecated: false, modalities: [] };
    }
  }

  async function checkHuggingFaceModel(modelId: string): Promise<{ found: boolean; deprecated: boolean; modalities: string[] }> {
    try {
      const response = await fetch("https://router.huggingface.co/v1/models", {
        headers: { "user-agent": "gtm-engine-preflight-api" },
      });

      if (!response.ok) {
        warnings.push(`${modelId}: Could not fetch HF router catalog (${response.status})`);
        return { found: false, deprecated: false, modalities: [] };
      }

      const data = (await response.json()) as { data?: Array<{ id: string }> };
      const model = data.data?.find((m) => m.id === modelId);

      if (!model) {
        return { found: false, deprecated: false, modalities: [] };
      }

      return { found: true, deprecated: false, modalities: ["text"] };
    } catch (error) {
      warnings.push(`${modelId}: HF check failed: ${error instanceof Error ? error.message : String(error)}`);
      return { found: false, deprecated: false, modalities: [] };
    }
  }

  // Collect all referenced models with their stages
  for (const stack of PRESET_STACKS) {
    for (const [stage, modelId] of Object.entries(stack.models)) {
      if (modelId && modelId !== "auto") {
        if (!modelStages.has(modelId)) modelStages.set(modelId, new Set());
        modelStages.get(modelId)!.add(stage);
      }
    }
  }

  for (const [stage, modelId] of Object.entries(STAGE_DEFAULTS)) {
    if (modelId && modelId !== "auto") {
      if (!modelStages.has(modelId)) modelStages.set(modelId, new Set());
      modelStages.get(modelId)!.add(stage);
    }
  }

  // From render-deps fallbacks
  for (const modelId of RENDER_DEPS_FALLBACKS) {
    if (modelId && modelId !== "auto") {
      if (!modelStages.has(modelId)) modelStages.set(modelId, new Set());
      // Infer stage from model name
      if (modelId.includes("video") || modelId.includes("seedance")) modelStages.get(modelId)!.add("video");
      else if (modelId.includes("sound") || modelId.includes("sfx")) modelStages.get(modelId)!.add("sfx");
      else if (modelId.includes("music") || modelId.includes("audio")) modelStages.get(modelId)!.add("music");
      else if (modelId.includes("gemini") || modelId.includes("flash")) modelStages.get(modelId)!.add("qa");
    }
  }

  // Check each referenced model
  for (const [modelId, stages] of modelStages.entries()) {
    if (checked.has(modelId)) continue;
    checked.add(modelId);

    const primaryStage = Array.from(stages)[0];

    // Skip "auto" and local models
    if (modelId === "auto" || modelId.startsWith("local-")) {
      continue;
    }

    const entry = CATALOG.find((e) => e.id === modelId);
    if (!entry) {
      errors.push(`${modelId}: NOT FOUND in catalog`);
      continue;
    }

    if (entry.runnable === false) {
      warnings.push(`${modelId}: Marked as not runnable in catalog`);
      continue;
    }

    // Check provider availability
    const provider = entry.provider;
    let result: { found: boolean; deprecated: boolean; modalities: string[] };

    if (provider === "fal") {
      result = await checkFalModel(modelId);
    } else if (provider === "openrouter") {
      result = await checkOpenRouterModel(modelId);
    } else if (provider === "huggingface") {
      result = await checkHuggingFaceModel(modelId);
    } else if (provider === "local-synth" || provider === "local-blender" || provider === "local-remotion") {
      continue; // Skip local models
    } else if (provider === "hfmcp" || provider === "higgsfield") {
      continue; // Skip auth-required models
    } else {
      warnings.push(`${modelId}: Unknown provider ${provider}`);
      continue;
    }

    // Check if model was found
    if (!result.found) {
      errors.push(`${modelId}: NOT FOUND in ${provider} catalog`);
      continue;
    }

    // Check if deprecated
    if (result.deprecated) {
      errors.push(`${modelId}: DEPRECATED`);
      continue;
    }

    // Check modality match
    if (primaryStage && STAGE_MODALITIES[primaryStage]) {
      const expectedModalities = STAGE_MODALITIES[primaryStage];
      const hasMatchingModality = result.modalities.some(m => expectedModalities.includes(m));

      if (!hasMatchingModality && result.modalities.length > 0) {
        // Special case: text models can't be in image/video/audio roles
        if (expectedModalities.includes("image") || expectedModalities.includes("video") || expectedModalities.includes("audio")) {
          if (result.modalities.includes("text") && !result.modalities.includes(expectedModalities[0])) {
            errors.push(`${modelId}: MODALITY MISMATCH - text model in ${primaryStage} role (expected ${expectedModalities.join("|")})`);
            continue;
          }
        }

        warnings.push(`${modelId}: Possible modality mismatch - has ${result.modalities.join("|")}, ${primaryStage} expects ${expectedModalities.join("|")}`);
      }
    }
  }

  const ok = errors.length === 0;

  return NextResponse.json({
    ok,
    errors,
    warnings,
    checked: checked.size,
  });
}
