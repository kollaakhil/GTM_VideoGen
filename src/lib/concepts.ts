import { chatJSON, aiConfigured } from "./ai";
import { principlesBlock, vocBlock } from "./ad-wisdom";
import { diversityScores } from "./pipeline";
import type { Brief, Concept, Research, StyleDNA, Swipe, VoiceOfCustomer } from "./types";

const AWARENESS = ["unaware", "problem", "solution", "product", "most"] as const;

/** Minimum distinctness (0-1, Jaccard distance on the concept's descriptors) for a concept to count as its own creative. */
export const MIN_DIVERSITY = 0.55;

const descriptor = (c: Concept) => [c.persona, c.angle, c.format, c.visualWorld, c.talent, c.setting, c.hook].join(" ");

/**
 * Entity-ID diversity gate: ad platforms cluster look-alike ads into one entity, so the selected set must differ in
 * persona, angle, format and setting. Greedy max-min selection over distinct (persona, angle, format) tuples.
 */
export function selectDiverse(concepts: Concept[], k = 3): Concept[] {
  const scores = diversityScores(concepts.map(descriptor));
  const scored = concepts.map((c, i) => ({ ...c, diversity: scores[i] }));
  const picked: Concept[] = [];
  const key = (c: Concept) => `${c.persona}|${c.angle}|${c.format}`.toLowerCase();
  for (const c of [...scored].sort((a, b) => (b.diversity ?? 0) - (a.diversity ?? 0))) {
    if (picked.length >= k) break;
    const clash = picked.some(
      (p) => key(p) === key(c) || p.setting.toLowerCase() === c.setting.toLowerCase() || (p.format === c.format && p.angle === c.angle) || p.persona === c.persona && p.format === c.format,
    );
    if (!clash) picked.push(c);
  }
  for (const c of scored) if (picked.length < k && !picked.includes(c)) picked.push(c);
  const ids = new Set(picked.map((c) => c.id));
  const pickedScores = diversityScores(picked.map(descriptor));
  const byId = Object.fromEntries(picked.map((c, i) => [c.id, pickedScores[i]]));
  return scored.map((c) => ({ ...c, diversity: byId[c.id] ?? c.diversity, selected: ids.has(c.id) }));
}

export const diversityIssues = (selected: Concept[]) =>
  selected.filter((c) => (c.diversity ?? 0) < MIN_DIVERSITY).map((c) => `"${c.hook}" is too close to another concept (${Math.round((c.diversity ?? 0) * 100)}% distinct)`);

const swipeBlock = (s: Swipe[]) =>
  s.length ? `\nSwipe file (borrow structure and pacing, never names, slogans or claims):\n${s.filter((x) => x.structure).map((x) => `- ${x.structure!.format}: hook "${x.structure!.hook}", beats ${x.structure!.beats.join(" > ")}. Why: ${x.structure!.whyItWorks}`).join("\n")}` : "";

/** Concept matrix: persona x awareness x angle x format, generated wide then narrowed by the diversity gate. */
export async function concepts(
  model: string,
  o: { research: Research; brief: Brief; voc?: VoiceOfCustomer | null; style?: StyleDNA | null; swipes?: Swipe[]; formats: string[]; rules?: string },
): Promise<{ data: Concept[]; cost: number }> {
  if (!aiConfigured()) {
    const demo: Concept[] = o.formats.slice(0, 6).map((f, i) => ({
      id: `con_${i}`, persona: ["Busy parent", "First-time host", "Gift buyer", "Planner", "Budget shopper", "Trend seeker"][i % 6], awareness: AWARENESS[i % 5],
      angle: o.research.angles[i % o.research.angles.length] ?? "Value", format: f, hook: `${o.research.angles[i % o.research.angles.length] ?? "Value"} hook ${i + 1}`,
      visualWorld: `World ${i}`, talent: `Person ${i}`, setting: `Setting ${i}`, why: "Demo concept",
    }));
    return { cost: 0, data: selectDiverse(demo) };
  }
  const { data, usage } = await chatJSON<{ concepts: Omit<Concept, "id">[] }>(
    model,
    "You are a performance creative strategist building a concept matrix. Each concept is a genuinely different ad: different buyer, awareness level, angle, format, talent and setting, so ad platforms treat each as a distinct creative.",
    `Research: ${JSON.stringify({ brand: o.research.brand, summary: o.research.summary, audience: o.research.audience, valueProps: o.research.valueProps, angles: o.research.angles })}\nBrief: ${JSON.stringify(o.brief)}${vocBlock(o.voc)}${swipeBlock(o.swipes ?? [])}${o.style ? `\nStyle inspiration (tone and pacing only): ${o.style.tone}; ${o.style.pacing}; hooks like ${o.style.hookPatterns.join(", ")}` : ""}${o.rules ?? ""}${principlesBlock()}\nAllowed formats: ${o.formats.join(", ")}\n\nReturn JSON: {"concepts":[{"persona" (specific buyer, max 8 words),"awareness" (one of ${AWARENESS.join(", ")}),"angle","format" (one of the allowed formats),"hook" (the first line, in customer language, max 12 words, only facts from the brief; no invented features, inclusions or guarantees),"visualWorld" (palette, light, look, max 15 words),"talent" (who is on screen, or "product only"),"setting" (one concrete place),"why" (one sentence: why this converts this persona)}]} with exactly 8 concepts. No two concepts may share the same persona+format or the same setting.`,
  );
  const list = data.concepts.slice(0, 8).map((c, i) => ({ ...c, id: `con_${i}`, format: o.formats.includes(c.format) ? c.format : o.formats[i % o.formats.length] }));
  return { data: selectDiverse(list), cost: usage.costUsd };
}
