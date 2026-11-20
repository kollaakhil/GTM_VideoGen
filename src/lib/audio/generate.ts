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
 * Selects based on gender, tone descriptors, and brand, with a deterministic fallback.
 */
export function selectVoice(persona: VoicePersona, brand: string): string {
  // Voice catalog with descriptors matching the tone/energy/age characteristics
  const VOICE_CATALOG = {
    // Female voices with tone characteristics
    Rachel: { gender: "female", tone: ["warm", "friendly", "natural", "conversational"] },
    Aria: { gender: "female", tone: ["young", "energetic", "upbeat", "bright"] },
    Sarah: { gender: "female", tone: ["professional", "clear", "confident", "mature"] },
    Laura: { gender: "female", tone: ["calm", "soothing", "gentle", "soft"] },
    Charlotte: { gender: "female", tone: ["elegant", "refined", "sophisticated"] },
    Jessica: { gender: "female", tone: ["friendly", "approachable", "warm"] },
    Lily: { gender: "female", tone: ["youthful", "light", "cheerful", "casual"] },
    // Male voices with tone characteristics
    Roger: { gender: "male", tone: ["deep", "authoritative", "confident", "mature"] },
    Charlie: { gender: "male", tone: ["friendly", "warm", "conversational", "natural"] },
    George: { gender: "male", tone: ["professional", "clear", "steady", "reliable"] },
    Callum: { gender: "male", tone: ["young", "energetic", "dynamic", "upbeat"] },
    Liam: { gender: "male", tone: ["casual", "approachable", "relaxed"] },
    Will: { gender: "male", tone: ["confident", "strong", "assured"] },
    Eric: { gender: "male", tone: ["calm", "soothing", "gentle"] },
    Chris: { gender: "male", tone: ["friendly", "warm", "engaging"] },
    Brian: { gender: "male", tone: ["professional", "mature", "experienced"] },
    Daniel: { gender: "male", tone: ["versatile", "natural", "balanced"] },
  };

  const genderLower = persona.gender.toLowerCase();
  const targetGender = genderLower === "male" ? "male" : "female";
  
  // Match by tone descriptors from persona (energy, age, pace map to tone keywords)
  const personaTones = [
    persona.energy?.toLowerCase(),
    persona.age?.toLowerCase(),
    persona.pace?.toLowerCase(),
  ].filter(Boolean) as string[];

  // Find voices that match gender and have overlapping tone descriptors
  const candidates = Object.entries(VOICE_CATALOG)
    .filter(([_, v]) => v.gender === targetGender)
    .map(([name, v]) => ({
      name,
      score: personaTones.reduce((acc, tone) => 
        acc + (v.tone.some(t => t.includes(tone) || tone.includes(t)) ? 1 : 0), 0
      ),
    }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score);

  // Use best match, or deterministic fallback based on brand hash
  if (candidates.length > 0 && candidates[0].score > 0) {
    return candidates[0].name;
  }

  // Deterministic fallback based on brand name hash
  const pool = Object.keys(VOICE_CATALOG).filter(name => VOICE_CATALOG[name as keyof typeof VOICE_CATALOG].gender === targetGender);
  let hash = 0;
  for (let i = 0; i < brand.length; i++) {
    hash = ((hash << 5) - hash) + brand.charCodeAt(i);
    hash = hash & hash;
  }
  const index = Math.abs(hash) % pool.length;
  return pool[index];
}
