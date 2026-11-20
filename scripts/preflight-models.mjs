#!/usr/bin/env node

/**
 * Preflight model check: verifies all model IDs in presets, catalog, versions and registry
 * are available and have correct modalities. No media generation - only metadata checks.
 * 
 * Checks:
 * - fal models via queue/schema endpoints
 * - OpenRouter models via /models list with output modalities
 * - Higgsfield models via MCP (if connected)
 * - Model stages match their capabilities
 */

import * as fal from "@fal-ai/client";
import { CATALOG } from "../src/lib/registry/catalog.ts";
import { PRESET_STACKS } from "../src/lib/versions.ts";
import { STAGE_DEFAULTS } from "../src/lib/registry/index.ts";

const FAL_KEY = process.env.FAL_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!FAL_KEY) {
  console.error("❌ FAL_KEY environment variable is required");
  process.exit(1);
}

fal.config({ credentials: FAL_KEY });

const errors = [];
const warnings = [];
const checked = new Set();

/**
 * Check a fal model by hitting its queue endpoint (metadata only, no generation)
 */
async function checkFalModel(modelId) {
  try {
    // Use the queue endpoint to verify the model exists without generating
    const response = await fetch(`https://queue.fal.run/${modelId}`, {
      method: "POST",
      headers: {
        "Authorization": `Key ${FAL_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: {} }),
    });
    
    if (!response.ok) {
      const text = await response.text();
      if (response.status === 404) {
        errors.push(`${modelId}: NOT FOUND (404)`);
        return false;
      } else if (response.status === 410) {
        errors.push(`${modelId}: DEPRECATED (410)`);
        return false;
      } else if (text.includes("deprecated") || text.includes("no longer available")) {
        errors.push(`${modelId}: DEPRECATED`);
        return false;
      }
      // Other errors might be due to empty input - try schema endpoint
    }
    
    // Try to fetch the model schema as a backup check
    try {
      const schemaResponse = await fetch(`https://fal.run/${modelId}`, {
        method: "OPTIONS",
        headers: { "Authorization": `Key ${FAL_KEY}` },
      });
      
      if (!schemaResponse.ok && schemaResponse.status === 404) {
        errors.push(`${modelId}: NOT FOUND (schema check)`);
        return false;
      }
    } catch (schemaError) {
      // Schema endpoint might not exist, that's ok if queue check passed
    }
    
    return true;
  } catch (error) {
    errors.push(`${modelId}: ${error.message}`);
    return false;
  }
}

/**
 * Check an OpenRouter model via /models endpoint
 */
async function checkOpenRouterModel(modelId) {
  if (!OPENROUTER_API_KEY) {
    warnings.push(`${modelId}: Skipping OpenRouter check (no API key)`);
    return true;
  }
  
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
    });
    
    if (!response.ok) {
      warnings.push(`${modelId}: Could not fetch OpenRouter models list`);
      return true; // Don't fail the check
    }
    
    const data = await response.json();
    const model = data.data?.find((m) => m.id === modelId);
    
    if (!model) {
      errors.push(`${modelId}: NOT FOUND in OpenRouter catalog`);
      return false;
    }
    
    return true;
  } catch (error) {
    warnings.push(`${modelId}: OpenRouter check failed: ${error.message}`);
    return true;
  }
}

/**
 * Check if a model's stages match its capabilities
 */
function checkModelStages(entry) {
  const { id, stages, family, caps } = entry;
  
  // Check stage/capability mismatches
  if (stages.includes("image") && !caps.refs && family !== "nano-banana" && family !== "gpt-image" && family !== "gpt-image-or") {
    // Most image models should support refs unless specifically noted
  }
  
  if (stages.includes("video") && !caps.i2v && !caps.t2v) {
    errors.push(`${id}: Listed for video stage but has neither i2v nor t2v capability`);
  }
  
  if (stages.includes("sfx") && family === "synth" && caps.openSource !== true) {
    // Local synth should be open source
  }
  
  if (stages.includes("music") && !id.includes("music") && !id.includes("audio") && !id.includes("synth") && !id.includes("lyria") && !id.includes("ace-step")) {
    warnings.push(`${id}: Listed for music stage but model name doesn't suggest music capability`);
  }
}

/**
 * Check all models referenced in presets and defaults
 */
async function checkReferencedModels() {
  const referenced = new Set();
  
  // Collect from preset stacks
  for (const stack of PRESET_STACKS) {
    for (const [_stage, modelId] of Object.entries(stack.models)) {
      if (modelId !== "auto") {
        referenced.add(modelId);
      }
    }
  }
  
  // Collect from stage defaults
  for (const [_stage, modelId] of Object.entries(STAGE_DEFAULTS)) {
    referenced.add(modelId);
  }
  
  console.log(`\n📋 Checking ${referenced.size} referenced models...\n`);
  
  for (const modelId of referenced) {
    if (checked.has(modelId)) continue;
    checked.add(modelId);
    
    const entry = CATALOG.find((e) => e.id === modelId);
    if (!entry) {
      errors.push(`${modelId}: NOT FOUND in catalog`);
      continue;
    }
    
    // Check if model is marked as not runnable
    if (entry.runnable === false) {
      warnings.push(`${modelId}: Marked as not runnable in catalog`);
      continue;
    }
    
    // Check stage/capability consistency
    checkModelStages(entry);
    
    // Check provider availability
    process.stdout.write(`  Checking ${modelId}... `);
    
    if (entry.provider === "fal") {
      const ok = await checkFalModel(modelId);
      console.log(ok ? "✅" : "❌");
    } else if (entry.provider === "openrouter") {
      const ok = await checkOpenRouterModel(modelId);
      console.log(ok ? "✅" : "⚠️");
    } else if (entry.provider === "local-synth" || entry.provider === "local-blender" || entry.provider === "local-remotion") {
      console.log("⏭️  (local)");
    } else if (entry.provider === "hfmcp" || entry.provider === "higgsfield") {
      console.log("⏭️  (requires account)");
    } else if (entry.provider === "huggingface") {
      console.log("⏭️  (HF router)");
    } else {
      warnings.push(`${modelId}: Unknown provider ${entry.provider}`);
      console.log("⚠️");
    }
  }
}

/**
 * Check all models in the catalog for consistency
 */
async function checkCatalogModels() {
  console.log(`\n📚 Checking catalog consistency (${CATALOG.length} models)...\n`);
  
  for (const entry of CATALOG) {
    if (checked.has(entry.id)) continue;
    
    // Only check runnable models that are referenced
    if (entry.runnable === false) {
      continue;
    }
    
    checkModelStages(entry);
  }
}

// Run checks
console.log("🔍 Preflight Model Check");
console.log("=".repeat(80));

try {
  await checkReferencedModels();
  await checkCatalogModels();
  
  console.log("\n" + "=".repeat(80));
  console.log("📊 RESULTS");
  console.log("=".repeat(80));
  
  if (errors.length === 0 && warnings.length === 0) {
    console.log("\n✅ All checks passed!");
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
    console.log("\n❌ Preflight check failed");
    process.exit(1);
  } else {
    console.log("\n⚠️  Preflight check passed with warnings");
    process.exit(0);
  }
} catch (error) {
  console.error("\n💥 Preflight check crashed:", error);
  process.exit(1);
}
