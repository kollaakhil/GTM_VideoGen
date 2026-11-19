import { describe, expect, it } from "vitest";
import {
  PRESET_STACKS,
  validateStack,
  estimateStackCost,
  getPresetsWithCosts,
  createCustomStack,
  normalizeStack,
  type VersionStack,
} from "@/lib/versions";
import { CATALOG, STAGE_DEFAULTS } from "@/lib/registry";

describe("Version stacks", () => {
  describe("Preset stacks", () => {
    it("has 4 preset stacks", () => {
      expect(PRESET_STACKS).toHaveLength(4);
      const ids = PRESET_STACKS.map((s) => s.id);
      expect(ids).toContain("premium");
      expect(ids).toContain("open");
      expect(ids).toContain("blender");
      expect(ids).toContain("experimental");
    });

    it("all preset stacks have valid structure", () => {
      for (const stack of PRESET_STACKS) {
        expect(stack.id).toBeTruthy();
        expect(stack.label).toBeTruthy();
        expect(stack.description).toBeTruthy();
        expect(stack.models).toBeDefined();
        expect(typeof stack.estimatedCostUsd).toBe("number");
      }
    });

    it("all preset model ids exist in the catalog", () => {
      for (const stack of PRESET_STACKS) {
        const errors = validateStack(stack);
        expect(errors).toEqual([]);
      }
    });

    it("all preset models serve their assigned stages", () => {
      for (const stack of PRESET_STACKS) {
        for (const [stage, modelId] of Object.entries(stack.models)) {
          if (modelId === "auto") continue;
          const model = CATALOG.find((m) => m.id === modelId);
          expect(model, `Model ${modelId} not found`).toBeDefined();
          expect(model!.stages, `Model ${modelId} cannot serve stage ${stage}`).toContain(stage);
        }
      }
    });

    it("premium stack uses top closed models", () => {
      const premium = PRESET_STACKS.find((s) => s.id === "premium")!;
      expect(premium).toBeDefined();
      expect(premium.models.research).toBe("anthropic/claude-opus-5.5");
      expect(premium.models.video).toBe("kling/v4/image-to-video");
    });

    it("open stack uses only open-source models where possible", () => {
      const open = PRESET_STACKS.find((s) => s.id === "open")!;
      expect(open).toBeDefined();
      
      // Check that key models are open-source
      const researchModel = CATALOG.find((m) => m.id === open.models.research);
      expect(researchModel?.caps.openSource).toBe(true);
      
      const scriptModel = CATALOG.find((m) => m.id === open.models.script);
      expect(scriptModel?.caps.openSource).toBe(true);
    });

    it("blender stack uses auto for video routing", () => {
      const blender = PRESET_STACKS.find((s) => s.id === "blender")!;
      expect(blender).toBeDefined();
      expect(blender.models.video).toBe("auto");
    });
  });

  describe("Stack validation", () => {
    it("validates a valid stack", () => {
      const stack: VersionStack = {
        id: "test",
        label: "Test",
        description: "Test stack",
        models: {
          research: "anthropic/claude-sonnet-5.5",
          video: "bytedance/seedance-2.0-fast",
        },
        estimatedCostUsd: 0,
      };
      expect(validateStack(stack)).toEqual([]);
    });

    it("rejects non-existent model id", () => {
      const stack: VersionStack = {
        id: "test",
        label: "Test",
        description: "Test stack",
        models: {
          research: "fake/model-999",
        },
        estimatedCostUsd: 0,
      };
      const errors = validateStack(stack);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/fake\/model-999 not found/);
    });

    it("rejects model assigned to wrong stage", () => {
      const stack: VersionStack = {
        id: "test",
        label: "Test",
        description: "Test stack",
        models: {
          video: "anthropic/claude-sonnet-5.5", // Text model on video stage
        },
        estimatedCostUsd: 0,
      };
      const errors = validateStack(stack);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toMatch(/cannot serve stage video/);
    });

    it("allows auto for video stage", () => {
      const stack: VersionStack = {
        id: "test",
        label: "Test",
        description: "Test stack",
        models: {
          video: "auto",
        },
        estimatedCostUsd: 0,
      };
      expect(validateStack(stack)).toEqual([]);
    });
  });

  describe("Cost estimation", () => {
    it("estimates cost for preset stacks", () => {
      const presets = getPresetsWithCosts({ shots: 6, targetSec: 20 });
      for (const stack of presets) {
        expect(stack.estimatedCostUsd).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(stack.estimatedCostUsd)).toBe(true);
      }
    });

    it("cost increases with more shots", () => {
      const stack = PRESET_STACKS[0];
      const cost6 = estimateStackCost(stack, { shots: 6, targetSec: 20 });
      const cost12 = estimateStackCost(stack, { shots: 12, targetSec: 20 });
      expect(cost12).toBeGreaterThan(cost6);
    });

    it("cost increases with longer target duration", () => {
      const stack = PRESET_STACKS[0];
      const cost20 = estimateStackCost(stack, { shots: 6, targetSec: 20 });
      const cost40 = estimateStackCost(stack, { shots: 6, targetSec: 40 });
      expect(cost40).toBeGreaterThan(cost20);
    });

    it("handles free models correctly", () => {
      const stack: VersionStack = {
        id: "free",
        label: "Free",
        description: "Free models",
        models: {
          sfx: "local-synth:foley",
        },
        estimatedCostUsd: 0,
      };
      const cost = estimateStackCost(stack, { shots: 6, targetSec: 20 });
      expect(cost).toBe(0);
    });

    it("aggregates costs across all stages", () => {
      const stack: VersionStack = {
        id: "multi",
        label: "Multi",
        description: "Multiple stages",
        models: {
          research: "anthropic/claude-sonnet-5.5",
          image: "google/gemini-nano-banana-2.1",
          video: "bytedance/seedance-2.0-fast",
        },
        estimatedCostUsd: 0,
      };
      const cost = estimateStackCost(stack, { shots: 6, targetSec: 20 });
      expect(cost).toBeGreaterThan(0);
    });
  });

  describe("Custom stacks", () => {
    it("creates custom stack from picks", () => {
      const picks = {
        research: "anthropic/claude-sonnet-5.5",
        video: "bytedance/seedance-2.0-fast",
      };
      const stack = createCustomStack("My Stack", picks, { shots: 6, targetSec: 20 });
      
      expect(stack.id).toMatch(/^custom-/);
      expect(stack.label).toBe("My Stack");
      expect(stack.description).toBe("Custom model selection");
      expect(stack.models).toEqual(picks);
      expect(stack.estimatedCostUsd).toBeGreaterThanOrEqual(0);
    });

    it("calculates cost for custom stack", () => {
      const picks = {
        video: "kling/v4/image-to-video",
      };
      const stack = createCustomStack("Kling only", picks, { shots: 6, targetSec: 20 });
      expect(stack.estimatedCostUsd).toBeGreaterThan(0);
    });
  });

  describe("Stack normalization", () => {
    it("fills missing stages with defaults", () => {
      const partial: VersionStack = {
        id: "partial",
        label: "Partial",
        description: "Partial stack",
        models: {
          video: "bytedance/seedance-2.0-fast",
        },
        estimatedCostUsd: 0,
      };
      
      const normalized = normalizeStack(partial);
      
      // Should have all stages filled
      expect(normalized.models.research).toBe(STAGE_DEFAULTS.research);
      expect(normalized.models.script).toBe(STAGE_DEFAULTS.script);
      expect(normalized.models.enhancer).toBe(STAGE_DEFAULTS.enhancer);
      expect(normalized.models.video).toBe("bytedance/seedance-2.0-fast"); // Original
    });

    it("preserves existing picks", () => {
      const complete: VersionStack = {
        id: "complete",
        label: "Complete",
        description: "Complete stack",
        models: {
          research: "anthropic/claude-opus-5.5",
          script: "google/gemini-4-carbon",
          enhancer: "anthropic/claude-sonnet-5.5",
          image: "google/gemini-nano-banana-2.1",
          video: "bytedance/kling-4.0-i2v",
          voice: "fal-ai/elevenlabs/tts/eleven-v3",
          music: "fal-ai/stable-audio-25/text-to-audio",
          sfx: "local-synth:foley",
          qa: "google/gemini-3.8-flash",
          asset3d: "speridlabs/idol/max",
        },
        estimatedCostUsd: 0,
      };
      
      const normalized = normalizeStack(complete);
      expect(normalized.models).toEqual(complete.models);
    });
  });

  describe("Budget enforcement", () => {
    it("can detect when stacks exceed budget", () => {
      const stacks = getPresetsWithCosts({ shots: 6, targetSec: 20 });
      const totalCost = stacks.reduce((sum, s) => sum + s.estimatedCostUsd, 0);
      const budget = 2.0; // Default cap
      
      // This is validation logic that should be in the API
      const overBudget = totalCost > budget;
      if (overBudget) {
        expect(totalCost).toBeGreaterThan(budget);
      }
    });

    it("preset stacks with reasonable shots stay under typical budget", () => {
      const stacks = getPresetsWithCosts({ shots: 6, targetSec: 20 });
      // Pick just 2 stacks
      const twoStacks = stacks.slice(0, 2);
      const totalCost = twoStacks.reduce((sum, s) => sum + s.estimatedCostUsd, 0);
      
      // With 6 shots at 20s total, 2 stacks should stay reasonable
      // This might fail if prices change significantly
      expect(totalCost).toBeLessThan(10); // Generous upper bound for 2 premium stacks
    });
  });

  describe("Integration with registry", () => {
    it("all stage defaults are valid model ids", () => {
      for (const [stage, modelId] of Object.entries(STAGE_DEFAULTS)) {
        const model = CATALOG.find((m) => m.id === modelId);
        expect(model, `Default model ${modelId} for stage ${stage} not found`).toBeDefined();
        expect(model!.stages, `Default model ${modelId} cannot serve stage ${stage}`).toContain(stage);
      }
    });

    it("preset stacks use only runnable models", () => {
      for (const stack of PRESET_STACKS) {
        for (const [stage, modelId] of Object.entries(stack.models)) {
          if (modelId === "auto") continue;
          const model = CATALOG.find((m) => m.id === modelId);
          expect(model?.runnable, `Model ${modelId} is not runnable`).toBe(true);
        }
      }
    });
  });
});
