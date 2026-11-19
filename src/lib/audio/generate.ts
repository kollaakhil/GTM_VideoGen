import { paid } from "@/lib/render/cost-meter";
import { falRun } from "@/lib/ai";
import type { SfxCue, VoicePersona } from "./sound-design";
import { downloadAsDataUrl } from "@/lib/ai";

/**
 * Generated audio (video-to-audio SFX, music, voice selection) matched to picture. Uses fal models:
 * - MMAudio for video-to-audio SFX (default)
 * - ElevenLabs, Sonilo or others for text-to-audio SFX
 * - Existing musicBed() for music
 * - Maps voice persona to existing voices
 *
 * Models are now configurable via version stacks for quality control.
 */

// Default models - can be overridden via stackModels
const DEFAULT_SFX_MODEL = "fal-ai/mmaudio-v2";

// Model pricing (per second unless otherwise noted)
const MODEL_PRICING: Record<string, { pricePerSec?: number; pricePerClip?: number }> = {
  "fal-ai/mmaudio-v2": { pricePerSec: 0.001 },
  "sonilo/v1.1/text-to-sound-effects": { pricePerSec: 0.0018 },
  "elevenlabs/sound-effects/v3": { pricePerSec: 0.002 },
  "fal-ai/stable-audio-3/small/sfx/text-to-audio": { pricePerClip: 0.02 },
  "cassetteai/sound-effects-generator": { pricePerClip: 0.02 },
  "mirelo-ai/sfx2.0/text-to-audio": { pricePerClip: 0.02 },
};

export interface GeneratedSfx {
  url: string;
  usd: number;
}

/**
 * Generate SFX from a rendered video clip. Supports multiple models:
 * - MMAudio (video-to-audio, default)
 * - ElevenLabs, Sonilo (text-to-audio)
 * Falls back to text-to-audio if video-to-audio unavailable.
 */
export async function generateVideoToAudioSfx(
  videoUrl: string,
  textPrompt: string,
  durationSeconds: number,
  model?: string,
): Promise<GeneratedSfx> {
  const modelId = model || DEFAULT_SFX_MODEL;
  const dur = Math.max(1, Math.min(10, Math.ceil(durationSeconds)));
  
  // Get pricing for the model
  const pricing = MODEL_PRICING[modelId] || { pricePerSec: 0.002 };
  const cost = pricing.pricePerSec ? pricing.pricePerSec * dur : pricing.pricePerClip || 0.02;
  
  return paid(`sfx:${modelId}`, cost, async () => {
    try {
      // Check if this is a video-to-audio model
      const isVideoToAudio = modelId.includes("mmaudio");
      
      if (isVideoToAudio) {
        const result = await falRun<{ audio?: { url: string } }>(modelId, {
          video_url: videoUrl,
          prompt: textPrompt,
          duration: dur,
        });

        if (!result.audio?.url) {
          throw new Error(`${modelId} returned no audio`);
        }

        const url = await downloadAsDataUrl(result.audio.url);
        return { url, usd: cost };
      } else {
        // Text-to-audio SFX
        return generateTextToAudioSfx(textPrompt, dur, modelId);
      }
    } catch (e) {
      console.warn(`[audio] ${modelId} failed (${(e as Error).message}), falling back to local lavfi`);
      throw e; // Let caller handle fallback
    }
  });
}

/**
 * Generate SFX from text description. Supports multiple text-to-audio models.
 * This is used for text-to-audio SFX models or as a fallback when video-to-audio is unavailable.
 */
export async function generateTextToAudioSfx(
  textPrompt: string,
  durationSeconds: number,
  model?: string,
): Promise<GeneratedSfx> {
  const modelId = model || "sonilo/v1.1/text-to-sound-effects";
  const dur = Math.max(1, Math.min(30, Math.ceil(durationSeconds)));
  
  // Get pricing for the model
  const pricing = MODEL_PRICING[modelId] || { pricePerSec: 0.002 };
  const cost = pricing.pricePerSec ? pricing.pricePerSec * dur : pricing.pricePerClip || 0.02;
  
  return paid(`sfx:${modelId}`, cost, async () => {
    const result = await falRun<{ audio?: { url: string } }>(modelId, {
      prompt: textPrompt,
      duration: dur,
    });

    if (!result.audio?.url) {
      throw new Error(`${modelId} returned no audio`);
    }

    const url = await downloadAsDataUrl(result.audio.url);
    return { url, usd: cost };
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

  const gender = persona.gender.toLowerCase().includes("male") ? "male" : "female";
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
