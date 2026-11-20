import type { Brief, Research } from "@/lib/types";
import type { Chat } from "./writer";

/**
 * A story concept: the creative premise, structure and world for one ad execution.
 * Generated before the sheet to ensure creative variety across runs.
 */
export interface Concept {
  id: string;
  logline: string;
  premise: string;
  structure: string;
  setting: string;
  character: string | null;
  visualWorld: string;
  tone: string;
  openingShot: string;
  keyDevice: string | null;
}

export interface ConceptChoice {
  concepts: Concept[];
  chosenId: string;
  chosenAt: string;
}

const CONCEPT_SYSTEM = `You are a creative director brainstorming ad concepts. You generate distinct story approaches that feel different from each other and from stock advertising tropes. Each concept must have a unique premise, structure, visual world and opening.`;

/**
 * Generates 3 distinct story concepts for an ad, ensuring creative variety.
 * Each concept has a different premise, structure, setting and visual approach.
 */
export async function generateConcepts(
  chat: Chat,
  input: {
    brand: string;
    goal: string;
    brief: Brief | null;
    research: Research | null;
    targetSec: number;
  }
): Promise<Concept[]> {
  const { data } = await chat<{ concepts: Omit<Concept, "id">[] }>(
    CONCEPT_SYSTEM,
    `Brand: ${input.brand}
Goal: ${input.goal}
Brief: ${input.brief ? JSON.stringify(input.brief) : "(none)"}
Audience: ${input.research?.audience ?? "(unknown)"}
Tone: ${input.research?.tone ?? "(unknown)"}
Duration: ${input.targetSec}s

Generate 3 DISTINCT story concepts for this ad. Each must feel completely different:
- Different premise (problem/solution, testimonial, demonstration, story arc, visual metaphor, etc.)
- Different structure (linear, loop, before/after, day-in-the-life, montage, etc.)
- Different setting (kitchen, office, outdoors, studio, abstract space, etc.)
- Different visual world (realistic, stylized, minimal, maximal, gritty, polished, etc.)
- Different opening shot and key device

AVOID these stock devices unless they're genuinely the best fit:
- Text on walls or location title cards
- "Confession to camera" format (unless it fits the brand)
- Generic product glamour shots
- Talking head testimonials without a twist

Return JSON:
{"concepts":[{
  "logline":"One-sentence premise (max 20 words)",
  "premise":"The core idea: what problem, insight or story drives this? (max 40 words)",
  "structure":"How the story unfolds: linear, loop, parallel, reveal, etc. (max 20 words)",
  "setting":"Where it takes place, specific and visual (max 20 words)",
  "character":"Who we follow, if anyone, or null for abstract/product-only",
  "visualWorld":"Overall visual style and aesthetic (max 30 words)",
  "tone":"Emotional tone: urgent, playful, calm, bold, etc. (max 15 words)",
  "openingShot":"The very first shot, specific and arresting (max 25 words)",
  "keyDevice":"The one memorable visual device or technique, or null if none"
}]} with exactly 3 concepts`
  );

  return (data.concepts ?? []).slice(0, 3).map((c, i) => ({
    id: `concept_${i + 1}`,
    ...c,
  }));
}

/**
 * Picks the strongest concept based on clarity, distinctiveness and fit.
 * Can be overridden by user choice.
 */
export function pickStrongestConcept(concepts: Concept[]): string {
  if (concepts.length === 0) throw new Error("No concepts to pick from");
  
  // For now, pick the first one (can be enhanced with scoring logic)
  // In the UI, the user can override this choice
  return concepts[0].id;
}

/**
 * Novelty guard: checks if a concept repeats recent patterns.
 * Returns warnings for stock devices that appear too frequently.
 */
export interface NoveltyCheck {
  warnings: string[];
  repeatedDevices: string[];
}

// Simple in-memory store for novelty checking (in production, this would be persistent)
const recentDevices = new Set<string>();
const recentOpenings = new Set<string>();
const recentSettings = new Set<string>();

export function checkNovelty(concept: Concept): NoveltyCheck {
  const warnings: string[] = [];
  const repeatedDevices: string[] = [];

  // Normalize for comparison
  const normDevice = concept.keyDevice?.toLowerCase().trim();
  const normOpening = concept.openingShot.toLowerCase().slice(0, 50);
  const normSetting = concept.setting.toLowerCase().trim();

  // Check for repeated devices
  if (normDevice && recentDevices.has(normDevice)) {
    warnings.push(`Key device "${concept.keyDevice}" was recently used`);
    repeatedDevices.push(normDevice);
  }

  // Check for repeated openings
  if (recentOpenings.has(normOpening)) {
    warnings.push(`Similar opening shot was recently used`);
  }

  // Check for repeated settings
  if (recentSettings.has(normSetting)) {
    warnings.push(`Setting "${concept.setting}" was recently used`);
  }

  // Check for stock devices
  const stockDevices = [
    { pattern: /\btext (on|painted|written) (the |a )?wall/i, name: "text on wall" },
    { pattern: /\blocation (title|card|text)\b/i, name: "location title card" },
    { pattern: /\b(generic|standard) (product|glamour) shot/i, name: "generic product shot" },
  ];

  for (const { pattern, name } of stockDevices) {
    const allText = `${concept.visualWorld} ${concept.openingShot} ${concept.keyDevice || ""}`;
    if (pattern.test(allText)) {
      warnings.push(`Uses stock device: ${name}`);
      repeatedDevices.push(name);
    }
  }

  return { warnings, repeatedDevices };
}

export function recordConcept(concept: Concept): void {
  if (concept.keyDevice) {
    recentDevices.add(concept.keyDevice.toLowerCase().trim());
  }
  recentOpenings.add(concept.openingShot.toLowerCase().slice(0, 50));
  recentSettings.add(concept.setting.toLowerCase().trim());

  // Keep only last 10 items (simple LRU)
  if (recentDevices.size > 10) {
    const first = recentDevices.values().next().value;
    if (first) recentDevices.delete(first);
  }
  if (recentOpenings.size > 10) {
    const first = recentOpenings.values().next().value;
    if (first) recentOpenings.delete(first);
  }
  if (recentSettings.size > 10) {
    const first = recentSettings.values().next().value;
    if (first) recentSettings.delete(first);
  }
}
