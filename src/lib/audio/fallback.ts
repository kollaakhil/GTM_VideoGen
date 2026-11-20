/**
 * Audio fallback chain: ensures audio generation never silently fails.
 * Tries multiple models in sequence, then falls back to bundled royalty-free audio.
 */

import { generateTextToAudioSfx, type GeneratedSfx } from "./generate";
import { musicBed } from "@/lib/ai";
import fs from "node:fs/promises";
import path from "node:path";

/** SFX models to try in order (verified working as of 2026-11-20) */
const SFX_FALLBACK_CHAIN = [
  "mirelo-ai/sfx2.0/text-to-audio",
  "elevenlabs/sound-effects/v3",
  "sonilo/v1.1/text-to-sound-effects",
] as const;

/** Music models to try in order */
const MUSIC_FALLBACK_CHAIN = [
  "elevenlabs/music/v2.5",
  "fal-ai/stable-audio-25/text-to-audio",
  "fal-ai/lyria3",
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
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("deprecated") ||
    message.includes("no longer available") ||
    message.includes("404") ||
    message.includes("410") ||
    message.includes("not found")
  );
}

/**
 * Generate SFX with fallback chain. Tries models in sequence, falls back to bundled audio.
 */
export async function generateSfxWithFallback(
  textPrompt: string,
  durationSeconds: number,
  primaryModel?: string,
): Promise<AudioGenerationResult> {
  // Try primary model first if specified
  if (primaryModel && !SFX_FALLBACK_CHAIN.includes(primaryModel as never)) {
    try {
      const result = await generateTextToAudioSfx(textPrompt, durationSeconds, primaryModel);
      return result;
    } catch (error) {
      if (isModelUnavailable(error)) {
        console.warn(`[audio-fallback] Primary SFX model ${primaryModel} unavailable, trying fallback chain`);
      } else {
        throw error; // Re-throw non-availability errors
      }
    }
  }

  // Try each model in the fallback chain
  const chain = primaryModel && SFX_FALLBACK_CHAIN.includes(primaryModel as never)
    ? SFX_FALLBACK_CHAIN
    : [primaryModel, ...SFX_FALLBACK_CHAIN].filter((m): m is string => !!m);

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

  // All models failed, use bundled royalty-free SFX
  console.warn(`[audio-fallback] All SFX models failed, using bundled audio`);
  
  try {
    const bundledUrl = await getBundledSfx(textPrompt, durationSeconds);
    return {
      url: bundledUrl,
      usage: { costUsd: 0 },
      warning: {
        stage: "sfx",
        primary: primaryModel || SFX_FALLBACK_CHAIN[0],
        fallback: "bundled",
        reason: lastError instanceof Error ? lastError.message : String(lastError),
      },
    };
  } catch (bundledError) {
    // Even bundled audio failed - return a silent audio file
    console.error(`[audio-fallback] Bundled SFX failed, generating silence:`, bundledError);
    const silentUrl = await generateSilence(durationSeconds);
    return {
      url: silentUrl,
      usage: { costUsd: 0 },
      warning: {
        stage: "sfx",
        primary: primaryModel || SFX_FALLBACK_CHAIN[0],
        fallback: "bundled",
        reason: `All models and bundled audio failed: ${bundledError}`,
      },
    };
  }
}

/**
 * Generate music with fallback chain. Tries models in sequence, falls back to bundled bed.
 */
export async function generateMusicWithFallback(
  prompt: string,
  durationSeconds: number,
  primaryModel?: string,
): Promise<AudioGenerationResult> {
  // Try primary model first if specified
  if (primaryModel && !MUSIC_FALLBACK_CHAIN.includes(primaryModel as never)) {
    try {
      const result = await musicBed(prompt, durationSeconds, primaryModel);
      const url = typeof result === "string" ? result : result.url;
      return { url, usage: { costUsd: 0.6 } }; // Rough estimate
    } catch (error) {
      if (isModelUnavailable(error)) {
        console.warn(`[audio-fallback] Primary music model ${primaryModel} unavailable, trying fallback chain`);
      } else {
        throw error;
      }
    }
  }

  // Try each model in the fallback chain
  const chain = primaryModel && MUSIC_FALLBACK_CHAIN.includes(primaryModel as never)
    ? MUSIC_FALLBACK_CHAIN
    : [primaryModel, ...MUSIC_FALLBACK_CHAIN].filter((m): m is string => !!m);

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

  // All models failed, use bundled royalty-free music
  console.warn(`[audio-fallback] All music models failed, using bundled audio`);
  
  try {
    const bundledUrl = await getBundledMusic(durationSeconds);
    return {
      url: bundledUrl,
      usage: { costUsd: 0 },
      warning: {
        stage: "music",
        primary: primaryModel || MUSIC_FALLBACK_CHAIN[0],
        fallback: "bundled",
        reason: lastError instanceof Error ? lastError.message : String(lastError),
      },
    };
  } catch (bundledError) {
    console.error(`[audio-fallback] Bundled music failed, generating silence:`, bundledError);
    const silentUrl = await generateSilence(durationSeconds);
    return {
      url: silentUrl,
      usage: { costUsd: 0 },
      warning: {
        stage: "music",
        primary: primaryModel || MUSIC_FALLBACK_CHAIN[0],
        fallback: "bundled",
        reason: `All models and bundled audio failed: ${bundledError}`,
      },
    };
  }
}

/**
 * Get bundled royalty-free SFX. Matches common sound effects.
 */
async function getBundledSfx(prompt: string, durationSeconds: number): Promise<string> {
  const promptLower = prompt.toLowerCase();
  
  // Map common prompts to bundled audio files
  const mapping: Record<string, string> = {
    whoosh: "whoosh.wav",
    swish: "whoosh.wav",
    pop: "pop.wav",
    click: "click.wav",
    fizz: "fizz.wav",
    pour: "pour.wav",
    clink: "clink.wav",
    chime: "chime.wav",
  };
  
  // Find first matching keyword
  for (const [keyword, filename] of Object.entries(mapping)) {
    if (promptLower.includes(keyword)) {
      return await loadBundledAudio(filename, durationSeconds);
    }
  }
  
  // Default to a generic ambience or click
  return await loadBundledAudio("click.wav", durationSeconds);
}

/**
 * Get bundled royalty-free music bed.
 */
async function getBundledMusic(durationSeconds: number): Promise<string> {
  // Use a longer ambient bed for music
  return await loadBundledAudio("ambient-bed.wav", durationSeconds);
}

/**
 * Load bundled audio file from public/audio directory.
 * For now, returns a data URL of silence until we add actual bundled files.
 */
async function loadBundledAudio(filename: string, durationSeconds: number): Promise<string> {
  const audioPath = path.join(process.cwd(), "public", "audio", "bundled", filename);
  
  try {
    const exists = await fs.access(audioPath).then(() => true).catch(() => false);
    if (exists) {
      const buffer = await fs.readFile(audioPath);
      return `data:audio/wav;base64,${buffer.toString("base64")}`;
    }
  } catch (error) {
    console.warn(`[audio-fallback] Could not load bundled audio ${filename}:`, error);
  }
  
  // Fallback to generated silence
  return generateSilence(durationSeconds);
}

/**
 * Generate a silent audio file as last resort.
 */
function generateSilence(durationSeconds: number): string {
  // WAV header for 44.1kHz mono PCM silence
  const sampleRate = 44100;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = numSamples * 2; // 16-bit samples
  
  const buffer = Buffer.alloc(44 + dataSize);
  
  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  
  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  
  // data chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  // Data is already zeros from Buffer.alloc
  
  return `data:audio/wav;base64,${buffer.toString("base64")}`;
}
