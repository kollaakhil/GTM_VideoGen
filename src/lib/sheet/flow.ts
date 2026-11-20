import { chatJSON } from "@/lib/ai";
import { brief as writeBrief, research as doResearch } from "@/lib/pipeline";
import { breakdownInspiration } from "@/lib/inspiration";
import { newId, storeMedia } from "@/lib/store";
import { sheetGate } from "./gate";
import { BASE_RULES, RULES_PROMPT, cleanRules, knownRules } from "./rules";
import { parseSheet, type ShotSheet } from "@/lib/shot-sheet";
import { fitTimings } from "./timing";
import { writeSheet, type Chat } from "./writer";
import { meterFor, nowIso, saveProgress, timed } from "./jobs";
import type { SheetRun } from "./run-types";

export const CHEAP_TEXT = process.env.SHEET_TEXT_MODEL || "google/gemini-3.8-flash";
export const CHEAP_VISION = process.env.SHEET_VISION_MODEL || "google/gemini-3.8-flash";
/** Per text call reservation; flash calls cost well under a cent, this only guards the cap. */
const TEXT_ESTIMATE = 0.02;

export type NewRunInput = {
  brandUrl: string; brand?: string; goal: string; offer?: string | null; facts?: string; inspirationUrl?: string | null; photos?: string[];
  targetSec?: number; aspect?: ShotSheet["aspect"]; audioMode?: ShotSheet["audioMode"]; patternId?: string; capUsd?: number; textModel?: string; visionModel?: string;
};

const nameOf = (url: string) => {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "").split(".")[0];
    return h.charAt(0).toUpperCase() + h.slice(1);
  } catch {
    return "Brand";
  }
};

export function newSheetRun(i: NewRunInput, user: string): SheetRun {
  return {
    id: newId("sr"), createdBy: user, createdAt: nowIso(), updatedAt: nowIso(), status: "idle", activity: null, error: null, step: "brand",
    input: {
      brandUrl: i.brandUrl, brand: i.brand?.trim() || nameOf(i.brandUrl), goal: i.goal, offer: i.offer ?? null, facts: i.facts ?? "", inspirationUrl: i.inspirationUrl || null,
      photos: i.photos ?? [], targetSec: i.targetSec ?? 20, aspect: i.aspect ?? "16:9", audioMode: i.audioMode ?? "foley", patternId: i.patternId ?? "confession_loop",
      textModel: i.textModel || CHEAP_TEXT, visionModel: i.visionModel || CHEAP_VISION,
    },
    research: null, brief: null, rules: [], ruleSource: null, script: null, sheet: null, gate: null, gateOverride: null, versions: [],
    picks: { mode: "video", video: null, shots: {} }, final: null, timings: [],
    cost: { capUsd: i.capUsd ?? (Number(process.env.RUN_CAP_USD) || 2), spentUsd: 0, entries: [] },
  };
}

export function chatFor(run: SheetRun, stage: string): Chat {
  const meter = meterFor(run);
  return <T,>(system: string, user: string) =>
    meter.run({ stage, what: `${stage} text call`, model: run.input.textModel, estimate: TEXT_ESTIMATE }, async () => {
      const { data, usage } = await chatJSON<T>(run.input.textModel, system, user);
      return { value: { data, usd: usage.costUsd }, usd: usage.costUsd };
    });
}

/** Step 2: research + brief (one call each on the cheap text model) and the style rules from the inspiration. */
export async function runBrief(run: SheetRun) {
  const meter = meterFor(run);
  const goal = `${run.input.goal}${run.input.facts ? `\nVerified facts (use only these): ${run.input.facts}` : ""}`;
  run.research = await timed(run, "research", () =>
    meter.run({ stage: "brief", what: "research", model: run.input.textModel, estimate: TEXT_ESTIMATE }, async () => {
      const r = await doResearch(run.input.textModel, run.input.brandUrl, goal);
      return { value: r.data, usd: r.cost };
    }));
  run.brief = await timed(run, "brief", () =>
    meter.run({ stage: "brief", what: "brief", model: run.input.textModel, estimate: TEXT_ESTIMATE }, async () => {
      const b = await writeBrief(run.input.textModel, run.research!, goal);
      return { value: b.data, usd: b.cost };
    }));
  await timed(run, "style rules", () => loadRules(run));
  run.step = "brief";
  await saveProgress(run);
}

export async function loadRules(run: SheetRun) {
  const known = knownRules(run.input.inspirationUrl);
  if (known) {
    run.rules = known.rules;
    run.ruleSource = known.name;
    return;
  }
  if (!run.input.inspirationUrl) {
    run.rules = BASE_RULES.map((r) => ({ ...r }));
    run.ruleSource = "Base craft rules (no inspiration video)";
    return;
  }
  const meter = meterFor(run);
  try {
    const { breakdown } = await meter.run({ stage: "brief", what: "inspiration breakdown", model: run.input.visionModel, estimate: 0.05 }, async () => {
      const b = await breakdownInspiration({ url: run.input.inspirationUrl! }, run.input.visionModel);
      return { value: b, usd: b.breakdown.costUsd };
    });
    const chat = chatFor(run, "rules");
    const { data } = await chat<{ rules?: { text?: string; check?: string | null }[] }>("You are a film craft analyst.", `${RULES_PROMPT}\n\nBreakdown: ${JSON.stringify({ ...breakdown, thumb: undefined })}`);
    run.rules = cleanRules(data.rules ?? []);
    run.ruleSource = `Broken down from ${run.input.inspirationUrl}`;
  } catch (e) {
    run.rules = BASE_RULES.map((r) => ({ ...r }));
    run.ruleSource = `Base rules (couldn't break down the inspiration: ${(e as Error).message.slice(0, 120)})`;
  }
}

/** Step 3: script + shot sheet, then check 1 (the gate). One repair pass with the gate's errors if it fails. */
export async function runSheet(run: SheetRun, chat: Chat = chatFor(run, "sheet")) {
  const input = {
    brand: run.input.brand, goal: run.input.goal, offer: run.input.offer, facts: run.input.facts, brief: run.brief, research: run.research,
    rules: run.rules, targetSec: run.input.targetSec, aspect: run.input.aspect, audioMode: run.input.audioMode, patternId: run.input.patternId, hasPhotos: run.input.photos.length > 0,
  };
  const version = (run.sheet?.version ?? 0) + 1;
  let out = await timed(run, "shot sheet", () => writeSheet(input, chat, [], version));
  let gate = sheetGate(out.sheet, { facts: factBase(run), rules: run.rules });
  if (!gate.pass) {
    out = await timed(run, "shot sheet repair", () => writeSheet(input, chat, gate.issues.filter((i) => i.level === "error"), version));
    gate = sheetGate(out.sheet, { facts: factBase(run), rules: run.rules, afterRepair: true });
  }
  
  // Generate character reference if character is defined and there are people shots
  if (out.sheet.character && out.sheet.character.description) {
    const peopleShots = out.sheet.shots.filter((s) => s.engine === "ai_video" && /\b(person|people|man|woman|actor|hand)\b/i.test(`${s.subject} ${s.prompt ?? ""}`));
    if (peopleShots.length > 0) {
      try {
        const meter = meterFor(run);
        const { generateImage, aiConfigured } = await import("@/lib/ai");
        if (aiConfigured()) {
          const charImg = await timed(run, "character reference", async () => {
            const result = await generateImage(
              run.input.visionModel,
              `Portrait reference image: ${out.sheet.character!.description}. Professional headshot style, neutral expression, well-lit, clear details. No text, logos or graphics.`,
              []
            );
            const stored = await storeMedia(result.url, `${run.id}/character-${Date.now()}`);
            return stored;
          });
          out.sheet.character.referenceUrl = charImg;
        }
      } catch (e) {
        console.warn("Failed to generate character reference:", e);
      }
    }
  }
  
  run.script = out.script;
  run.sheet = out.sheet;
  run.gate = gate;
  run.step = "sheet";
  await saveProgress(run);
}

/** What claims are checked against: the operator's verified facts, the offer and the brand name. */
export const factBase = (run: SheetRun) => [run.input.facts, run.input.offer ?? "", run.input.brand].join("\n");

/** Operator edit of the sheet: validate, re-route unlocked rows, refit the clock, re-run the gate. Free. */
export function applySheetEdit(run: SheetRun, raw: unknown) {
  const p = parseSheet(raw);
  if (!p.ok) return { error: p.error };
  const shots = fitTimings(p.sheet.shots.map((s, i) => ({ ...s, n: i + 1, id: s.id || `s${i + 1}` })), p.sheet.targetSec);
  run.sheet = { ...p.sheet, shots, version: (run.sheet?.version ?? 0) + 1 };
  run.gate = sheetGate(run.sheet, { facts: factBase(run), rules: run.sheet.rules, hasPhotos: run.input.photos.length > 0 });
  run.gateOverride = null; // Clear override when sheet is edited and re-gated
  return { ok: true as const };
}
