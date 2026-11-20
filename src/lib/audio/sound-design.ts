import { chatJSON } from "@/lib/ai";
import type { Brief } from "@/lib/types";
import type { ShotSheet } from "@/lib/shot-sheet";
import { text, list } from "@/lib/judge-schema";
import { z } from "zod";

/**
 * Sound design (per-video audio plan): from the sheet, brief and story pattern, produces a plan with SFX cues,
 * music decision and voice persona so each video's audio is unique and matches its content. Respects pattern rules
 * (e.g. "no music"). Uses a cheap text model.
 */

export interface SfxCue {
  /** Exact description specific to what's on screen (e.g. "ceramic mug set down on oak desk" not "thud"). */
  description: string;
  /** Which shot (0-indexed). */
  shot: number;
  /** Offset in seconds within the shot. */
  offset: number;
  /** Gain 0..1. */
  gain: number;
}

export interface VoicePersona {
  /** "male" | "female". */
  gender: string;
  /** e.g. "30s", "young adult", "mature". */
  age: string;
  /** e.g. "calm", "energetic", "warm". */
  energy: string;
  /** e.g. "steady", "quick", "slow". */
  pace: string;
}

export type MusicDecision = 
  | { type: "none" }
  | { type: "cue"; prompt: string; };

export interface SoundPlan {
  /** Per-shot SFX (0-3 per shot). */
  sfx: SfxCue[];
  music: MusicDecision;
  voice: VoicePersona;
}

const SfxCueSchema = z.object({
  description: text(200),
  shot: z.number().int().min(0),
  offset: z.number().min(0),
  gain: z.number().min(0).max(1).default(0.3),
});

const VoicePersonaSchema = z.object({
  gender: text(20),
  age: text(40),
  energy: text(40),
  pace: text(40),
});

const MusicDecisionSchema = z.union([
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("cue"), prompt: text(300) }),
]);

const SoundPlanSchema = z.object({
  sfx: list(SfxCueSchema, 40),
  music: MusicDecisionSchema,
  voice: VoicePersonaSchema,
});

function soundPrompt(sheet: ShotSheet, brief: Brief | null, patternName?: string): string {
  const shots = sheet.shots.map((s, i) => {
    const beat = s.beat ? ` Beat: ${s.beat}.` : "";
    const sheetSfx = s.audio.sfx ? ` Sheet SFX: "${s.audio.sfx}".` : "";
    return `Shot ${i + 1} (${(s.end - s.start).toFixed(1)}s): ${s.subject}. ${s.action}.` +
      ` VO: ${s.audio.vo ?? "(none)"}.${sheetSfx}${beat} Transition: ${s.transition}.`;
  }).join("\n");

  const brandInfo = brief ? `Objective: ${brief.objective}. Audience: ${brief.audience}. Insight: ${brief.insight}.` : "";
  const patternInfo = patternName ? `Story pattern: ${patternName}.` : "";
  
  // Find special beats for stings
  const butSilenceIdx = sheet.shots.findIndex((s) => s.beat === "but_silence");
  const endCardIdx = sheet.shots.findIndex((s) => s.shotType === "end card");
  let stingInstructions = "";
  if (butSilenceIdx >= 0) {
    stingInstructions += `\n- Add a short sting or impact sound at shot ${butSilenceIdx + 1} (the "but" turn) with offset around when the turn happens.`;
  }
  if (endCardIdx >= 0) {
    stingInstructions += `\n- Add a short sting or impact at shot ${endCardIdx + 1} (end card) with offset 0.0 for impact.`;
  }

  return `You are a sound designer. From this ad's shot sheet, product and story pattern, design unique audio that matches the content.

${brandInfo}
${patternInfo}

SHOT SHEET (${sheet.shots.length} shots, ${sheet.targetSec}s, ${sheet.audioMode} mode):
${shots}

PATTERN RULES:
${sheet.rules.map((r) => `- [${r.id}] ${r.text}`).join("\n") || "(none)"}

INSTRUCTIONS:
1. SFX: For each shot, create 0-3 cues. Each cue MUST:
   - Use the exact sheet SFX field when present
   - If sheet SFX is missing, derive from the shot's visible action and subject (describe the actual sound, material, and motion)
   - Set offset in seconds to when the action happens within that shot
   - Use gain 0.2-0.5 for subtle ambience, 0.6-0.8 for main action sounds${stingInstructions}
2. Music: Check the pattern rules. If any rule says to leave out music, omit background music, or pause music, then music MUST be { type: "none" }. Otherwise, provide a cue with a prompt describing genre, tempo, instruments and mood derived from THIS script's content (each run gets different music).
3. Voice: Choose gender, age, energy and pace from the brand and script.

Return JSON:
{
  "sfx": [{"description": "exact sound tied to visible action", "shot": 0, "offset": 0.5, "gain": 0.3}],
  "music": {"type": "none"} OR {"type": "cue", "prompt": "genre, tempo, instruments, mood"},
  "voice": {"gender": "female", "age": "30s", "energy": "warm", "pace": "steady"}
}`;
}

export async function designSound(
  sheet: ShotSheet,
  brief: Brief | null,
  model: string,
  patternName?: string,
): Promise<{ plan: SoundPlan; usd: number }> {
  const prompt = soundPrompt(sheet, brief, patternName);
  const { data, usage } = await chatJSON<unknown>(
    model,
    "You design audio for short ads. Be specific and concise.",
    prompt,
  );

  const parsed = SoundPlanSchema.safeParse(data);
  if (!parsed.success) {
    // Fallback: minimal plan with no SFX, no music, and a neutral voice
    return {
      plan: {
        sfx: [],
        music: { type: "none" },
        voice: { gender: "female", age: "30s", energy: "calm", pace: "steady" },
      },
      usd: usage.costUsd,
    };
  }

  return { plan: parsed.data, usd: usage.costUsd };
}
