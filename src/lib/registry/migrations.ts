/**
 * Model ID migrations: maps deprecated model IDs to their live replacements.
 * Used when loading stored runs or version stacks to ensure old references work.
 */

/** Deprecated model IDs that are no longer available on their providers. */
export const DEPRECATED_MODELS = [
  "fal-ai/mmaudio-v2",
  "fal-ai/stable-audio-3/small/sfx/text-to-audio",
] as const;

/** Maps deprecated model IDs to their live replacements. */
export const MODEL_MIGRATIONS: Record<string, string> = {
  "fal-ai/mmaudio-v2": "mirelo-ai/sfx2.0/text-to-audio",
  "fal-ai/stable-audio-3/small/sfx/text-to-audio": "mirelo-ai/sfx2.0/text-to-audio",
};

/**
 * Migrates a model ID if it's deprecated, returning the replacement or the original.
 */
export function migrateModelId(modelId: string): string {
  return MODEL_MIGRATIONS[modelId] ?? modelId;
}

/**
 * Migrates a models object (Partial<Record<Stage, string>>), replacing any deprecated IDs.
 */
export function migrateModels<T extends Record<string, string | undefined>>(models: T): T {
  const result = { ...models };
  for (const [stage, modelId] of Object.entries(result)) {
    if (modelId && MODEL_MIGRATIONS[modelId]) {
      (result as Record<string, string>)[stage] = MODEL_MIGRATIONS[modelId];
    }
  }
  return result;
}
