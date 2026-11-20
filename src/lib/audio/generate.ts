import { paid } from "@/lib/render/cost-meter";
import { falRun } from "@/lib/ai";
import type { SfxCue, VoicePersona } from "./sound-design";
import { downloadAsDataUrl } from "@/lib/ai";
import { FAL_KNOBS } from "@/lib/registry/fal-snapshot";

/**
 * Generated audio (video-to-audio SFX, music, voice selection) matched to picture. Uses fal models:
 * - Mirelo for text-to-audio SFX (default, working as of 2026-11-20)
 * - ElevenLabs v3 for text-to-audio SFX (fallback)
 * - Existing musicBed() for music
 * - Maps voice persona to existing voices
 *
 * Models are now configurable via version stacks for quality control.
 */

// Default models - can be overridden via stackModels (verified working 2026-11-20)
const DEFAULT_SFX_MODEL = "mirelo-ai/sfx2.0/text-to-audio";

// Model pricing (per second unless otherwise noted)
const MODEL_PRICING: Record<string, { pricePerSec?: number; pricePerClip?: number }> = {
  "sonilo/v1.1/text-to-sound-effects": { pricePerSec: 0.0018 },
  "elevenlabs/sound-effects/v3": { pricePerSec: 0.002 },
  "cassetteai/sound-effects-generator": { pricePerClip: 0.02 },
  "mirelo-ai/sfx2.0/text-to-audio": { pricePerClip: 0.02 },
};

export interface GeneratedSfx {
  url: string;
  usage: { costUsd: number };
}

/**
 * Generate SFX from text description. All current working models are text-to-audio.
 * Falls back across models if the primary fails.
 */
export async function generateVideoToAudioSfx(
  videoUrl: string,
  textPrompt: string,
  durationSeconds: number,
  model?: string,
): Promise<GeneratedSfx> {
  // All working models are text-to-audio; video-to-audio models are deprecated
  return generateTextToAudioSfx(textPrompt, durationSeconds, model);
}

/**
 * Generate SFX from text description. Supports multiple text-to-audio models.
 * Uses per-model input keys from FAL_KNOBS snapshot.
 */
export async function generateTextToAudioSfx(
  textPrompt: string,
  durationSeconds: number,
  model?: string,
): Promise<GeneratedSfx> {
  const modelId = model || DEFAULT_SFX_MODEL;
  const dur = Math.max(1, Math.min(30, Math.ceil(durationSeconds)));
  
  // Get pricing for the model
  const pricing = MODEL_PRICING[modelId] || { pricePerSec: 0.002 };
  const cost = pricing.pricePerSec ? pricing.pricePerSec * dur : pricing.pricePerClip || 0.02;
  
  return paid(`sfx:${modelId}`, cost, async () => {
    // Build input using model-specific keys from FAL_KNOBS
    const knobs = FAL_KNOBS[modelId];
    const input: Record<string, unknown> = {};
    
    // Set text prompt using the correct key for this model
    if (knobs?.text) {
      input[knobs.text] = textPrompt;
    } else {
      // Fallback to prompt if no knobs entry
      input.prompt = textPrompt;
    }
    
    // Set duration using the correct key for this model
    if (knobs?.dur) {
      const durConfig = knobs.dur;
      if (typeof durConfig === "object" && "key" in durConfig) {
        input[durConfig.key] = dur;
      }
    } else {
      // Fallback to duration if no knobs entry
      input.duration = dur;
    }

    interface AudioResult {
      audio?: { url: string } | { url: string }[];
    }
    
    const result = await falRun<AudioResult>(modelId, input);

    // Handle both single audio object and array of audio objects (mirelo returns array)
    let audioUrl: string | undefined;
    if (result.audio) {
      if (Array.isArray(result.audio)) {
        audioUrl = result.audio[0]?.url;
      } else {
        audioUrl = result.audio.url;
      }
    }

    if (!audioUrl) {
      throw new Error(`${modelId} returned no audio`);
    }

    const url = await downloadAsDataUrl(audioUrl);
    return { url, usage: { costUsd: cost } };
  });
}

/**
 * Map voice persona to a voice ID from the existing voices voiceover() supports.
 * Makes the choice deterministic per brand but not hard-coded to "Rachel".
 */
export function selectVoice(persona: VoicePersona, brand: string): string {
  const VOICES = {
    female: ["Rachel", "Aria", "Sarah", "Laura", "Charlotte", "Jessica", "Lily"],
    male: ["Roger", "Charlie", "George", "Callum", "Liam", "Will", "Eric", "Chris", "Brian", "Daniel"],
  };

  const genderLower = persona.gender.toLowerCase();
  const gender = genderLower === "male" ? "male" : "female";
  const pool = VOICES[gender] || VOICES.female;
  
  // Deterministic selection based on brand name hash
  let hash = 0;
  for (let i = 0; i < brand.length; i++) {
    hash = ((hash << 5) - hash) + brand.charCodeAt(i);
    hash = hash & hash;
  }
  
  const index = Math.abs(hash) % pool.length;
  return pool[index];
}
