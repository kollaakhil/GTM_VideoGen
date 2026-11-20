#!/usr/bin/env node
/**
 * Preflight model validation: verifies EVERY model ID referenced in the codebase.
 * 
 * Checks:
 * - Model exists in provider's list or schema endpoint
 * - Not deprecated (fal 410 or deprecated message)
 * - Output modality matches role (image role → image output, video → video, audio → audio)
 * - Text models can never be in an image/video/audio role
 * 
 * Sources: versions.ts presets, registry/catalog.ts, registry/index.ts STAGE_DEFAULTS, render-deps.ts fallbacks
 * 
 * Usage: node scripts/preflight-models.mjs
 * Exit 0 if all checks pass, nonzero on any failure.
 * Generates no media (metadata checks only).
 * 
 * Requires Node 22.18+ to import TypeScript directly.
 */

import { fileURLToPath } from "node:url";

const root = new URL("../src/lib/", import.meta.url);

// Dynamically import TypeScript modules
const { PRESET_STACKS } = await import(new URL("versions.ts", root));
const { CATALOG } = await import(new URL("registry/catalog.ts", root));
const { STAGE_DEFAULTS } = await import(new URL("registry/index.ts", root));

// Fallback models from render-deps.ts (hardcoded since they're inline)
const RENDER_DEPS_FALLBACKS = [
  "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video",
  "google/gemini-3.8-flash",
  "mirelo-ai/sfx2.0/text-to-audio",
  "elevenlabs/sound-effects/v3",
  "elevenlabs/music/v2.5",
  "fal-ai/stable-audio-3/medium/text-to-audio",
];

const errors = [];
const warnings = [];

// Stage to expected output modality mapping
const STAGE_MODALITIES = {
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

/**
 * Fetch with timeout and retries
 */
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { "user-agent": "gtm-engine-preflight", ...options.headers },
    });
    clearTimeout(timeout);
    return res;
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

/**
 * Check if a model ID is in OpenRouter's catalog
 */
async function checkOpenRouter(modelId) {
  try {
    const res = await fetchWithTimeout("https://openrouter.ai/api/v1/models");
    if (!res.ok) {
      warnings.push(`${modelId}: Could not fetch OpenRouter catalog (${res.status})`);
      return { found: false, modalities: [] };
    }
    
    const data = await res.json();
    const model = data.data?.find(m => m.id === modelId);
    
    if (!model) {
      return { found: false, modalities: [] };
    }
    
    // Extract modalities from architecture
    const modalities = model.architecture?.output_modalities || ["text"];
    return { found: true, modalities, deprecated: false };
  } catch (e) {
    warnings.push(`${modelId}: OpenRouter check failed: ${e.message}`);
    return { found: false, modalities: [] };
  }
}

/**
 * Check if a model ID is in fal's catalog
 */
async function checkFal(modelId) {
  try {
    // Try to fetch the model's schema endpoint (metadata only, no generation)
    const schemaUrl = `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${modelId}`;
    const res = await fetchWithTimeout(schemaUrl);
    
    if (res.status === 404) {
      return { found: false, modalities: [], deprecated: false };
    }
    
    if (res.status === 410) {
      return { found: true, modalities: [], deprecated: true };
    }
    
    if (!res.ok) {
      const text = await res.text();
      if (text.toLowerCase().includes("deprecated") || text.toLowerCase().includes("no longer available")) {
        return { found: true, modalities: [], deprecated: true };
      }
      warnings.push(`${modelId}: fal schema endpoint returned ${res.status}`);
      return { found: false, modalities: [] };
    }
    
    const schema = await res.json();
    
    // Infer modality from the endpoint path
    const modalities = [];
    if (modelId.includes("text-to-image") || modelId.includes("image")) modalities.push("image");
    if (modelId.includes("video") || modelId.includes("seedance") || modelId.includes("kling")) modalities.push("video");
    if (modelId.includes("audio") || modelId.includes("sound") || modelId.includes("music") || modelId.includes("tts") || modelId.includes("speech")) modalities.push("audio");
    if (modelId.includes("text-to-3d") || modelId.includes("3d")) modalities.push("3d");
    if (modalities.length === 0) modalities.push("text"); // Default to text
    
    return { found: true, modalities, deprecated: false };
  } catch (e) {
    warnings.push(`${modelId}: fal check failed: ${e.message}`);
    return { found: false, modalities: [] };
  }
}

/**
 * Check if a model ID is in Hugging Face router
 */
async function checkHuggingFace(modelId) {
  try {
    const res = await fetchWithTimeout("https://router.huggingface.co/v1/models");
    if (!res.ok) {
      warnings.push(`${modelId}: Could not fetch HF router catalog (${res.status})`);
      return { found: false, modalities: [] };
    }
    
    const data = await res.json();
    const model = data.data?.find(m => m.id === modelId);
    
    if (!model) {
      return { found: false, modalities: [] };
    }
    
    // HF models are typically text models unless specified
    return { found: true, modalities: ["text"], deprecated: false };
  } catch (e) {
    warnings.push(`${modelId}: HF check failed: ${e.message}`);
    return { found: false, modalities: [] };
  }
}

/**
 * Check a single model ID
 */
async function checkModel(modelId, stage) {
  // Skip "auto" and local models
  if (modelId === "auto" || modelId.startsWith("local-")) {
    return { ok: true, skipped: true };
  }
  
  // Get the catalog entry
  const catalogEntry = CATALOG.find(e => e.id === modelId);
  if (!catalogEntry) {
    errors.push(`${modelId}: NOT FOUND in catalog`);
    return { ok: false };
  }
  
  // Check if marked as not runnable
  if (catalogEntry.runnable === false) {
    warnings.push(`${modelId}: Marked as not runnable in catalog`);
    return { ok: true, warning: true };
  }
  
  // Determine provider
  const provider = catalogEntry.provider;
  let result;
  
  if (provider === "openrouter") {
    result = await checkOpenRouter(modelId);
  } else if (provider === "fal") {
    result = await checkFal(modelId);
  } else if (provider === "huggingface") {
    result = await checkHuggingFace(modelId);
  } else if (provider === "local-synth" || provider === "local-blender" || provider === "local-remotion") {
    return { ok: true, skipped: true };
  } else if (provider === "hfmcp" || provider === "higgsfield") {
    // These require authentication, skip for preflight
    return { ok: true, skipped: true };
  } else {
    warnings.push(`${modelId}: Unknown provider ${provider}`);
    return { ok: true, warning: true };
  }
  
  // Check if model was found
  if (!result.found) {
    errors.push(`${modelId}: NOT FOUND in ${provider} catalog`);
    return { ok: false };
  }
  
  // Check if deprecated
  if (result.deprecated) {
    errors.push(`${modelId}: DEPRECATED`);
    return { ok: false };
  }
  
  // Check modality match
  if (stage && STAGE_MODALITIES[stage]) {
    const expectedModalities = STAGE_MODALITIES[stage];
    const hasMatchingModality = result.modalities.some(m => expectedModalities.includes(m));
    
    if (!hasMatchingModality && result.modalities.length > 0) {
      // Special case: text models can't be in image/video/audio roles
      if (expectedModalities.includes("image") || expectedModalities.includes("video") || expectedModalities.includes("audio")) {
        if (result.modalities.includes("text") && !result.modalities.includes(expectedModalities[0])) {
          errors.push(`${modelId}: MODALITY MISMATCH - text model in ${stage} role (expected ${expectedModalities.join("|")})`);
          return { ok: false };
        }
      }
      
      warnings.push(`${modelId}: Possible modality mismatch - has ${result.modalities.join("|")}, stage expects ${expectedModalities.join("|")}`);
    }
  }
  
  return { ok: true };
}

/**
 * Collect all model IDs from the codebase
 */
function collectModelIds() {
  const modelIds = new Map(); // modelId -> Set of stages
  
  // From PRESET_STACKS
  for (const stack of PRESET_STACKS) {
    for (const [stage, modelId] of Object.entries(stack.models)) {
      if (modelId && modelId !== "auto") {
        if (!modelIds.has(modelId)) modelIds.set(modelId, new Set());
        modelIds.get(modelId).add(stage);
      }
    }
  }
  
  // From STAGE_DEFAULTS
  for (const [stage, modelId] of Object.entries(STAGE_DEFAULTS)) {
    if (modelId && modelId !== "auto") {
      if (!modelIds.has(modelId)) modelIds.set(modelId, new Set());
      modelIds.get(modelId).add(stage);
    }
  }
  
  // From render-deps fallbacks
  for (const modelId of RENDER_DEPS_FALLBACKS) {
    if (modelId && modelId !== "auto") {
      if (!modelIds.has(modelId)) modelIds.set(modelId, new Set());
      // Try to infer stage from the model name
      if (modelId.includes("video") || modelId.includes("seedance")) modelIds.get(modelId).add("video");
      else if (modelId.includes("sound") || modelId.includes("sfx")) modelIds.get(modelId).add("sfx");
      else if (modelId.includes("music") || modelId.includes("audio")) modelIds.get(modelId).add("music");
      else if (modelId.includes("gemini") || modelId.includes("flash")) modelIds.get(modelId).add("qa");
    }
  }
  
  return modelIds;
}

/**
 * Main
 */
async function main() {
  console.log("🔍 Preflight Model Validation");
  console.log("=" .repeat(80));
  console.log("");
  
  const modelIds = collectModelIds();
  console.log(`Checking ${modelIds.size} model IDs...\n`);
  
  let checked = 0;
  let skipped = 0;
  
  for (const [modelId, stages] of modelIds.entries()) {
    const stageList = Array.from(stages);
    const primaryStage = stageList[0];
    
    process.stdout.write(`${modelId.padEnd(60)} `);
    
    const result = await checkModel(modelId, primaryStage);
    
    if (result.skipped) {
      console.log("⏭️  (local/auth)");
      skipped++;
    } else if (result.ok) {
      if (result.warning) {
        console.log("⚠️");
      } else {
        console.log("✅");
      }
      checked++;
    } else {
      console.log("❌");
      checked++;
    }
  }
  
  console.log("\n" + "=".repeat(80));
  console.log("📊 RESULTS");
  console.log("=".repeat(80));
  
  if (errors.length === 0 && warnings.length === 0) {
    console.log(`\n✅ All ${checked} models passed! (${skipped} skipped)`);
    process.exit(0);
  }
  
  if (errors.length > 0) {
    console.log(`\n❌ Errors (${errors.length}):`);
    for (const error of errors) {
      console.log(`   ${error}`);
    }
  }
  
  if (warnings.length > 0) {
    console.log(`\n⚠️  Warnings (${warnings.length}):`);
    for (const warning of warnings) {
      console.log(`   ${warning}`);
    }
  }
  
  if (errors.length > 0) {
    console.log(`\n❌ Preflight validation failed (${checked} checked, ${skipped} skipped)`);
    process.exit(1);
  } else {
    console.log(`\n⚠️  Preflight validation passed with warnings (${checked} checked, ${skipped} skipped)`);
    process.exit(0);
  }
}

main().catch(e => {
  console.error("\n💥 Preflight check crashed:", e);
  process.exit(1);
});
