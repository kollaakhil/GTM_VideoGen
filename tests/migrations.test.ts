import { describe, it, expect } from "vitest";
import { DEPRECATED_MODELS, MODEL_MIGRATIONS, migrateModelId, migrateModels } from "../src/lib/registry/migrations";
import { PRESET_STACKS, migrateStack } from "../src/lib/versions";
import { STAGE_DEFAULTS } from "../src/lib/registry/index";
import { CATALOG } from "../src/lib/registry/catalog";

describe("Model Migrations", () => {
  describe("DEPRECATED_MODELS", () => {
    it("should list known deprecated models", () => {
      expect(DEPRECATED_MODELS).toContain("fal-ai/mmaudio-v2");
      expect(DEPRECATED_MODELS).toContain("fal-ai/stable-audio-3/small/sfx/text-to-audio");
    });

    it("should have migrations for all deprecated models", () => {
      for (const deprecated of DEPRECATED_MODELS) {
        expect(MODEL_MIGRATIONS).toHaveProperty(deprecated);
        expect(MODEL_MIGRATIONS[deprecated]).toBeTruthy();
      }
    });
  });

  describe("MODEL_MIGRATIONS", () => {
    it("should map deprecated SFX models to mirelo-ai/sfx2.0/text-to-audio", () => {
      expect(MODEL_MIGRATIONS["fal-ai/mmaudio-v2"]).toBe("mirelo-ai/sfx2.0/text-to-audio");
      expect(MODEL_MIGRATIONS["fal-ai/stable-audio-3/small/sfx/text-to-audio"]).toBe("mirelo-ai/sfx2.0/text-to-audio");
    });

    it("should map to models that exist in the catalog", () => {
      for (const [_deprecated, replacement] of Object.entries(MODEL_MIGRATIONS)) {
        const model = CATALOG.find((m) => m.id === replacement);
        expect(model).toBeDefined();
        expect(model?.runnable).toBe(true);
      }
    });
  });

  describe("migrateModelId", () => {
    it("should migrate deprecated model IDs", () => {
      expect(migrateModelId("fal-ai/mmaudio-v2")).toBe("mirelo-ai/sfx2.0/text-to-audio");
      expect(migrateModelId("fal-ai/stable-audio-3/small/sfx/text-to-audio")).toBe("mirelo-ai/sfx2.0/text-to-audio");
    });

    it("should return non-deprecated IDs unchanged", () => {
      expect(migrateModelId("elevenlabs/sound-effects/v3")).toBe("elevenlabs/sound-effects/v3");
      expect(migrateModelId("mirelo-ai/sfx2.0/text-to-audio")).toBe("mirelo-ai/sfx2.0/text-to-audio");
    });
  });

  describe("migrateModels", () => {
    it("should migrate deprecated models in a models object", () => {
      const input = {
        sfx: "fal-ai/mmaudio-v2",
        music: "elevenlabs/music/v2.5",
        voice: "elevenlabs/tts/eleven-v4",
      };
      const result = migrateModels(input);
      expect(result.sfx).toBe("mirelo-ai/sfx2.0/text-to-audio");
      expect(result.music).toBe("elevenlabs/music/v2.5");
      expect(result.voice).toBe("elevenlabs/tts/eleven-v4");
    });

    it("should handle empty objects", () => {
      expect(migrateModels({})).toEqual({});
    });

    it("should not mutate the original object", () => {
      const input = { sfx: "fal-ai/mmaudio-v2" };
      const result = migrateModels(input);
      expect(input.sfx).toBe("fal-ai/mmaudio-v2");
      expect(result.sfx).toBe("mirelo-ai/sfx2.0/text-to-audio");
    });
  });

  describe("migrateStack", () => {
    it("should migrate deprecated models in a version stack", () => {
      const stack = {
        id: "test",
        label: "Test",
        description: "Test stack",
        models: {
          sfx: "fal-ai/mmaudio-v2",
          music: "elevenlabs/music/v2.5",
        },
        estimatedCostUsd: 0,
      };
      const result = migrateStack(stack);
      expect(result.models.sfx).toBe("mirelo-ai/sfx2.0/text-to-audio");
      expect(result.models.music).toBe("elevenlabs/music/v2.5");
    });
  });
});

describe("Preset Stacks", () => {
  it("should not reference any deprecated models", () => {
    for (const stack of PRESET_STACKS) {
      for (const [stage, modelId] of Object.entries(stack.models)) {
        if (modelId !== "auto") {
          expect(DEPRECATED_MODELS).not.toContain(modelId);
        }
      }
    }
  });

  it("should use mirelo-ai/sfx2.0/text-to-audio or elevenlabs/sound-effects/v3 for SFX", () => {
    const validSfxModels = ["mirelo-ai/sfx2.0/text-to-audio", "elevenlabs/sound-effects/v3"];
    for (const stack of PRESET_STACKS) {
      if (stack.models.sfx) {
        expect(validSfxModels).toContain(stack.models.sfx);
      }
    }
  });
});

describe("Stage Defaults", () => {
  it("should not reference any deprecated models", () => {
    for (const [_stage, modelId] of Object.entries(STAGE_DEFAULTS)) {
      expect(DEPRECATED_MODELS).not.toContain(modelId);
    }
  });

  it("should use mirelo-ai/sfx2.0/text-to-audio as the SFX default", () => {
    expect(STAGE_DEFAULTS.sfx).toBe("mirelo-ai/sfx2.0/text-to-audio");
  });
});

describe("Catalog Deprecated Models", () => {
  it("should mark deprecated models as not runnable", () => {
    for (const deprecated of DEPRECATED_MODELS) {
      const model = CATALOG.find((m) => m.id === deprecated);
      expect(model).toBeDefined();
      expect(model?.runnable).toBe(false);
    }
  });

  it("should have verify notes for deprecated models", () => {
    for (const deprecated of DEPRECATED_MODELS) {
      const model = CATALOG.find((m) => m.id === deprecated);
      expect(model).toBeDefined();
      expect(model?.verify.note).toContain("deprecated");
    }
  });

  it("should ensure replacement models are runnable", () => {
    const replacementModel = CATALOG.find((m) => m.id === "mirelo-ai/sfx2.0/text-to-audio");
    expect(replacementModel).toBeDefined();
    expect(replacementModel?.runnable).toBe(true);
    expect(replacementModel?.stages).toContain("sfx");
  });

  it("should ensure fallback model is runnable", () => {
    const fallbackModel = CATALOG.find((m) => m.id === "elevenlabs/sound-effects/v3");
    expect(fallbackModel).toBeDefined();
    expect(fallbackModel?.runnable).toBe(true);
    expect(fallbackModel?.stages).toContain("sfx");
  });
});
