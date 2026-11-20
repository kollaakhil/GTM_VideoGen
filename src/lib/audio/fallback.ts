/**
 * Audio fallback chain: ensures audio generation never silently fails.
 * Tries multiple models in sequence, then falls back to bundled royalty-free audio.
 */

import { generateTextToAudioSfx, type GeneratedSfx } from "./generate";
import { musicBed } from "@/lib/ai";

/** SFX models to try in order (verified working as of 2026-11-20) */
const SFX_FALLBACK_CHAIN = [
  "mirelo-ai/sfx2.0/text-to-audio",
  "elevenlabs/sound-effects/v3",
] as const;

/** Music models to try in order (verified working as of 2026-11-20) */
const MUSIC_FALLBACK_CHAIN = [
  "elevenlabs/music/v2.5",
  "fal-ai/stable-audio-3/medium/text-to-audio",
] as const;

export interface FallbackWarning {
  stage: "sfx" | "music";
  primary: string;
  fallback: string | "bundled";
  reason: string;
}

export interface AudioGenerationResult {
  url: string;
  usage: { costUsd: number };
  warning?: FallbackWarning;
}

/** Check if an error indicates a deprecated or unavailable model */
function isModelUnavailable(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes("deprecated") || msg.includes("no longer available") || msg.includes("not found");
  }
  
  // Check error object properties
  if (typeof error === "object" && error !== null) {
    const err = error as { status?: number; message?: string };
    if (err.status === 404 || err.status === 410) {
      return true;
    }
    if (err.message) {
      const msg = err.message.toLowerCase();
      return msg.includes("deprecated") || msg.includes("no longer available") || msg.includes("not found");
    }
  }
  
  // Check stringified error
  const message = String(error).toLowerCase();
  return message.includes("deprecated") || message.includes("no longer available") || message.includes("not found");
}

/**
 * Generate SFX with fallback chain. Tries models in sequence, falls back to bundled audio.
 */
export async function generateSfxWithFallback(
  textPrompt: string,
  durationSeconds: number,
  primaryModel?: string,
): Promise<AudioGenerationResult> {
  // Build the fallback chain
  let triedPrimaryOutsideChain = false;
  
  // Try primary model first if it's not in the fallback chain
  if (primaryModel && !SFX_FALLBACK_CHAIN.includes(primaryModel as never)) {
    try {
      const result = await generateTextToAudioSfx(textPrompt, durationSeconds, primaryModel);
      return result;
    } catch (error) {
      triedPrimaryOutsideChain = true;
      if (isModelUnavailable(error)) {
        console.warn(`[audio-fallback] Primary SFX model ${primaryModel} unavailable, trying fallback chain`);
      } else {
        throw error; // Re-throw non-availability errors
      }
    }
  }

  // Build chain: if we already tried primary, use just the fallback chain
  const chain = triedPrimaryOutsideChain ? [...SFX_FALLBACK_CHAIN] : 
    (primaryModel && SFX_FALLBACK_CHAIN.includes(primaryModel as never)
      ? SFX_FALLBACK_CHAIN
      : [primaryModel, ...SFX_FALLBACK_CHAIN].filter((m): m is string => !!m));

  let lastError: unknown;
  for (const model of chain) {
    try {
      const result = await generateTextToAudioSfx(textPrompt, durationSeconds, model);
      
      // If we didn't use the primary model, add a warning
      if (model !== (primaryModel || SFX_FALLBACK_CHAIN[0])) {
        return {
          ...result,
          warning: {
            stage: "sfx",
            primary: primaryModel || SFX_FALLBACK_CHAIN[0],
            fallback: model,
            reason: lastError instanceof Error ? lastError.message : String(lastError),
          },
        };
      }
      
      return result;
    } catch (error) {
      console.warn(`[audio-fallback] SFX model ${model} failed:`, error);
      lastError = error;
      
      // Only continue to next model if this one is unavailable
      if (!isModelUnavailable(error)) {
        throw error;
      }
    }
  }

  // All models failed - this is an error that must be visible in the UI
  const errorMessage = `All SFX models failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`;
  console.error(`[audio-fallback] ${errorMessage}`);
  
  // Throw with a special structure that the caller can detect and store as a visible warning
  const error = new Error(errorMessage) as Error & { 
    audioFallbackFailure: true; 
    stage: "sfx"; 
    primary: string; 
    lastError: unknown;
  };
  error.audioFallbackFailure = true;
  error.stage = "sfx";
  error.primary = primaryModel || SFX_FALLBACK_CHAIN[0];
  error.lastError = lastError;
  throw error;
}

/**
 * Generate music with fallback chain. Tries models in sequence, falls back to bundled bed.
 */
export async function generateMusicWithFallback(
  prompt: string,
  durationSeconds: number,
  primaryModel?: string,
): Promise<AudioGenerationResult> {
  // Build the fallback chain
  let triedPrimaryOutsideChain = false;
  
  // Try primary model first if it's not in the fallback chain
  if (primaryModel && !MUSIC_FALLBACK_CHAIN.includes(primaryModel as never)) {
    try {
      const result = await musicBed(prompt, durationSeconds, primaryModel);
      const url = typeof result === "string" ? result : result.url;
      return { url, usage: { costUsd: 0.6 } }; // Rough estimate
    } catch (error) {
      triedPrimaryOutsideChain = true;
      if (isModelUnavailable(error)) {
        console.warn(`[audio-fallback] Primary music model ${primaryModel} unavailable, trying fallback chain`);
      } else {
        throw error;
      }
    }
  }

  // Build chain: if we already tried primary, use just the fallback chain
  const chain = triedPrimaryOutsideChain ? [...MUSIC_FALLBACK_CHAIN] : 
    (primaryModel && MUSIC_FALLBACK_CHAIN.includes(primaryModel as never)
      ? MUSIC_FALLBACK_CHAIN
      : [primaryModel, ...MUSIC_FALLBACK_CHAIN].filter((m): m is string => !!m));

  let lastError: unknown;
  for (const model of chain) {
    try {
      const result = await musicBed(prompt, durationSeconds, model);
      const url = typeof result === "string" ? result : result.url;
      
      // If we didn't use the primary model, add a warning
      if (model !== (primaryModel || MUSIC_FALLBACK_CHAIN[0])) {
        return {
          url,
          usage: { costUsd: 0.6 },
          warning: {
            stage: "music",
            primary: primaryModel || MUSIC_FALLBACK_CHAIN[0],
            fallback: model,
            reason: lastError instanceof Error ? lastError.message : String(lastError),
          },
        };
      }
      
      return { url, usage: { costUsd: 0.6 } };
    } catch (error) {
      console.warn(`[audio-fallback] Music model ${model} failed:`, error);
      lastError = error;
      
      if (!isModelUnavailable(error)) {
        throw error;
      }
    }
  }

  // All models failed - this is an error that must be visible in the UI
  const errorMessage = `All music models failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`;
  console.error(`[audio-fallback] ${errorMessage}`);
  
  // Throw with a special structure that the caller can detect and store as a visible warning
  const error = new Error(errorMessage) as Error & { 
    audioFallbackFailure: true; 
    stage: "music"; 
    primary: string; 
    lastError: unknown;
  };
  error.audioFallbackFailure = true;
  error.stage = "music";
  error.primary = primaryModel || MUSIC_FALLBACK_CHAIN[0];
  error.lastError = lastError;
  throw error;
}
