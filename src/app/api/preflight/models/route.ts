import { NextResponse } from "next/server";
import { CATALOG } from "@/lib/registry/catalog";
import { PRESET_STACKS } from "@/lib/versions";
import { STAGE_DEFAULTS } from "@/lib/registry";

/**
 * Preflight model check API: verifies all referenced models are available.
 * Called by Studio before any spend to catch deprecated/missing models early.
 * 
 * GET /api/preflight/models
 * Returns: { ok: boolean, errors: string[], warnings: string[], checked: number }
 */
export async function GET() {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checked = new Set<string>();

  const FAL_KEY = process.env.FAL_KEY;
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

  if (!FAL_KEY) {
    return NextResponse.json(
      { ok: false, errors: ["FAL_KEY not configured"], warnings: [], checked: 0 },
      { status: 500 }
    );
  }

  async function checkFalModel(modelId: string): Promise<boolean> {
    try {
      const response = await fetch(`https://queue.fal.run/${modelId}`, {
        method: "POST",
        headers: {
          Authorization: `Key ${FAL_KEY}`,
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
      }

      return true;
    } catch (error) {
      errors.push(`${modelId}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async function checkOpenRouterModel(modelId: string): Promise<boolean> {
    if (!OPENROUTER_API_KEY) {
      warnings.push(`${modelId}: Skipping OpenRouter check (no API key)`);
      return true;
    }

    try {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        warnings.push(`${modelId}: Could not fetch OpenRouter models list`);
        return true;
      }

      const data = (await response.json()) as { data?: Array<{ id: string }> };
      const model = data.data?.find((m) => m.id === modelId);

      if (!model) {
        errors.push(`${modelId}: NOT FOUND in OpenRouter catalog`);
        return false;
      }

      return true;
    } catch (error) {
      warnings.push(`${modelId}: OpenRouter check failed: ${error instanceof Error ? error.message : String(error)}`);
      return true;
    }
  }

  // Collect all referenced models
  const referenced = new Set<string>();

  for (const stack of PRESET_STACKS) {
    for (const modelId of Object.values(stack.models)) {
      if (modelId && modelId !== "auto") {
        referenced.add(modelId);
      }
    }
  }

  for (const modelId of Object.values(STAGE_DEFAULTS)) {
    referenced.add(modelId);
  }

  // Check each referenced model
  for (const modelId of referenced) {
    if (checked.has(modelId)) continue;
    checked.add(modelId);

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
    if (entry.provider === "fal") {
      await checkFalModel(modelId);
    } else if (entry.provider === "openrouter") {
      await checkOpenRouterModel(modelId);
    }
    // Skip checks for local, hfmcp, higgsfield, and huggingface providers
  }

  const ok = errors.length === 0;

  return NextResponse.json({
    ok,
    errors,
    warnings,
    checked: checked.size,
  });
}
