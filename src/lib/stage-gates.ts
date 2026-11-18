import { z } from "zod";
import { chatJSON, type Part } from "./ai";
import { clamp, stageScore, threshold, type Check } from "./stage-policy";
import type { JudgeCalibration, Research, Shot, ShotQA, StageScore, StudioRun, VoiceOfCustomer } from "./types";

/** Judges and rule checks for each stage gate (thresholds and blocking live in stage-policy.ts). */

/** Cheap judge for every gate: the run's vision model (a flash-class model) reads text and frames. */
export const gateJudge = (run: Pick<StudioRun, "models">) => process.env.GATE_JUDGE_MODEL || run.models.vision;

// ---------- Research ----------

/** Rule checks: source coverage, depth, customer evidence and named competitors. */
export function researchRules(r: Research, voc?: VoiceOfCustomer | null): Check[] {
  const sources = new Set([...(r.sources ?? []), ...(voc?.sources ?? [])]).size;
  const comps = r.competitors?.filter((c) => c.name.trim()) ?? [];
  return [
    { name: "source coverage", score: sources >= 4 ? 10 : sources >= 2 ? 7 : 4, note: `${sources} distinct sources`, by: "rules" },
    { name: "depth", score: Math.min(10, 2 * Math.min(r.valueProps.length, 3) + Math.min(r.angles.length, 4)), note: `${r.valueProps.length} value props, ${r.angles.length} angles`, by: "rules" },
    { name: "customer evidence", score: voc?.sourcedQuotes?.length ? 10 : voc?.phrases.length ? 7 : 3, note: voc ? `${voc.phrases.length} phrases, ${voc.sourcedQuotes?.length ?? 0} sourced quotes` : "No customer language", by: "rules", weight: 0.5 },
    { name: "competitors", score: comps.length >= 2 ? 10 : comps.length ? 7 : 4, note: comps.length ? comps.map((c) => c.name).join(", ") : "No competitors named", by: "rules" },
  ];
}

const ResearchVerdict = z.object({
  grounded: z.number().min(0).max(10),
  evidence: z.number().min(0).max(10),
  competitors: z.number().min(0).max(10),
  unsupported: z.array(z.string().max(300)).max(10),
  notes: z.array(z.string().max(300)).max(6),
});

/** Judge: every fact must trace to the site text; competitors must be real companies in the category. */
export async function judgeResearch(model: string, r: Research, siteText: string) {
  const { data, usage } = await chatJSON<unknown>(model, "You are a strict fact-checker for marketing research. Return only JSON.", `Website text (the only ground truth):\n${siteText.slice(0, 12000) || "(unavailable)"}\n\nResearch to check: ${JSON.stringify({ brand: r.brand, summary: r.summary, audience: r.audience, valueProps: r.valueProps, competitors: r.competitors ?? [] })}
Score 0–10: "grounded" (10 = every fact is in the website text; list each fact that is not as "unsupported", quoted from the research), "evidence" (value props backed by concrete proof such as numbers, materials, guarantees or reviews), "competitors" (named competitors are real companies selling a similar product; 0 if invented, 3 if none named). Add up to 3 notes on how to fix the research.
Return JSON {"grounded":number,"evidence":number,"competitors":number,"unsupported":[string],"notes":[string]}`);
  const v = ResearchVerdict.safeParse(data);
  if (!v.success) return { checks: [] as Check[], unsupported: [] as string[], notes: ["Research judge returned an incomplete verdict."], cost: usage.costUsd };
  const d = v.data;
  return {
    checks: [
      { name: "no hallucinated facts", score: d.unsupported.length ? Math.min(d.grounded, 6) : d.grounded, note: d.unsupported.length ? `Unsupported: ${d.unsupported.join("; ")}` : "Every fact found on the site", by: "judge" as const, weight: 2 },
      { name: "evidence", score: d.evidence, note: "", by: "judge" as const },
      { name: "real competitors", score: d.competitors, note: "", by: "judge" as const },
    ],
    unsupported: d.unsupported,
    notes: d.notes,
    cost: usage.costUsd,
  };
}

// ---------- Shot instructions ----------

const words = (s: string) => s.toLowerCase().match(/[a-z]{3,}/g) ?? [];
const LENS = /\b(\d{2,3}\s?mm|wide|telephoto|macro|close-up|closeup|medium|full shot|overhead|top-down|eye level|low angle|shallow depth|portrait lens)\b/i;
const LIGHT = /\b(light|lit|sun|golden|daylight|window|shadow|backlit|soft|neon|lamp|glow)\b/i;

/** Rule checks on the shot list: specific, framed, lit, matching the locked script, with a shared cast and set. */
export function shotRules(shots: Shot[]): Check[] {
  const n = shots.length || 1;
  const specific = shots.filter((s) => words(s.visual).length >= 14).length / n;
  const framed = shots.filter((s) => LENS.test(`${s.visual} ${s.camera}`)).length / n;
  const lit = shots.filter((s) => LIGHT.test(s.visual)).length / n;
  const match = shots.map((s) => {
    const want = new Set(words(s.expectedVisual ?? ""));
    if (!want.size) return 1;
    const have = new Set(words(s.visual));
    return [...want].filter((w) => have.has(w)).length / want.size;
  });
  const sets = shots.map((s) => new Set(words(s.visual)));
  const shared = sets.length > 1 ? [...sets[0]].filter((w) => sets.slice(1).filter((x) => x.has(w)).length >= Math.ceil((sets.length - 1) / 2)).length : 4;
  return [
    { name: "specific", score: clamp(specific * 10), note: `${Math.round(specific * 100)}% of shots name subject, action and setting in 14+ words`, by: "rules" },
    { name: "lens & framing", score: clamp(4 + framed * 6), note: `${Math.round(framed * 100)}% state a lens or framing`, by: "rules" },
    { name: "lighting", score: clamp(4 + lit * 6), note: `${Math.round(lit * 100)}% describe light`, by: "rules", weight: 0.5 },
    { name: "matches script", score: clamp((match.reduce((a, b) => a + b, 0) / n) * 12), note: "Word overlap with each locked beat", by: "rules" },
    { name: "continuity anchors", score: shared >= 4 ? 10 : shared >= 2 ? 7 : 4, note: `${shared} shared cast/set/product words across shots`, by: "rules" },
  ];
}

const ShotVerdict = z.object({
  specificity: z.number().min(0).max(10),
  characters: z.number().min(0).max(10),
  set: z.number().min(0).max(10),
  lens: z.number().min(0).max(10),
  continuity: z.number().min(0).max(10),
  scriptMatch: z.number().min(0).max(10),
  fixes: z.array(z.string().max(300)).max(8),
});

export async function judgeShots(model: string, shots: Shot[]) {
  const { data, usage } = await chatJSON<unknown>(model, "You are a film director reviewing a shot list for an AI video model. Return only JSON.", `Shot list (each with its locked script beat): ${JSON.stringify(shots.map((s, i) => ({ n: i + 1, beat: s.beat, lockedAction: s.expectedVisual, visual: s.visual, camera: s.camera, vo: s.vo })))}
Score 0–10: "specificity" (one concrete, filmable scene per shot), "characters" (the same people described the same way in every shot they appear in), "set" (one consistent location, palette and light), "lens" (each shot states framing or lens and one camera move), "continuity" (shots cut together: matching product look, screen direction, time of day), "scriptMatch" (each shot shows its locked action, nothing replaced). List up to 6 concrete fixes ("Shot 3: …").
Return JSON {"specificity","characters","set","lens","continuity","scriptMatch","fixes":[string]}`);
  const v = ShotVerdict.safeParse(data);
  if (!v.success) return { checks: [] as Check[], fixes: [] as string[], cost: usage.costUsd };
  const d = v.data;
  return {
    checks: [
      { name: "specific (judge)", score: d.specificity, note: "", by: "judge" as const },
      { name: "consistent characters", score: d.characters, note: "", by: "judge" as const },
      { name: "consistent set", score: d.set, note: "", by: "judge" as const },
      { name: "lens & camera (judge)", score: d.lens, note: "", by: "judge" as const },
      { name: "continuity (judge)", score: d.continuity, note: "", by: "judge" as const },
      { name: "matches script (judge)", score: d.scriptMatch, note: "", by: "judge" as const, weight: 2 },
    ],
    fixes: d.fixes,
    cost: usage.costUsd,
  };
}

// ---------- Video, sound and edit ----------

/** Video stage: the per-scene frame checks (artifacts, product fidelity, on-brand look) already run per shot. */
export function videoChecks(shotQa: (ShotQA | null | undefined)[], craft: number): Check[] {
  const scores = shotQa.map((q) => (q ? (q.match === "fail" ? Math.min(q.score, 5) : q.score) : 0));
  const worst = scores.length ? Math.min(...scores) : 0;
  return [
    { name: "worst scene", score: worst, note: `Per-scene frame scores: ${scores.join(", ")}`, by: "judge", weight: 2 },
    { name: "average scene", score: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0, note: "", by: "judge" },
    { name: "finished creative", score: craft, note: "Creative Director filmstrip review", by: "judge" },
  ];
}

/** Sound & voice: WER vs the script, loudness near -14 LUFS, every line inside its shot, and the music bed. */
export function audioChecks(o: { wer: number | null; werVia?: string; lufs: number | null; peak: number | null; linesOutside: number; lines: number; musicPlanned: boolean; musicPresent: boolean; speechFails: number }): Check[] {
  const checks: Check[] = [
    o.wer === null
      ? { name: "WER vs script", score: o.speechFails ? 5 : 8, note: "Word timings unavailable; per-line speech check only", by: "rules", weight: 2 }
      : { name: "WER vs script", score: clamp(10 - o.wer * 40), note: `WER ${(o.wer * 100).toFixed(0)}% (${o.werVia ?? "builtin"})`, by: "rules", weight: 2 },
    o.lufs === null
      ? { name: "loudness", score: 5, note: "Loudness could not be measured", by: "rules" }
      : { name: "loudness", score: clamp(10 - Math.max(0, Math.abs(o.lufs + 14) - 1) * 2 - (o.peak !== null && o.peak > -1 ? 2 : 0)), note: `${o.lufs.toFixed(1)} LUFS, peak ${o.peak?.toFixed(1) ?? "?"} dBFS (target -14 LUFS, peak < -1)`, by: "rules" },
    { name: "voice sync", score: o.lines ? clamp(10 - (o.linesOutside / o.lines) * 10) : 10, note: o.linesOutside ? `${o.linesOutside} of ${o.lines} lines not heard inside their shot` : "Every line lands inside its shot", by: "rules" },
    { name: "speech per line", score: clamp(10 - o.speechFails * 3), note: o.speechFails ? `${o.speechFails} lines misheard` : "Every line verified", by: "rules" },
  ];
  if (o.musicPlanned) checks.push({ name: "music bed", score: o.musicPresent ? 9 : 3, note: o.musicPresent ? "Music mixed under the voice (ducked to 18%)" : "Planned music is missing", by: "rules", weight: 0.5 });
  return checks;
}

/** Edit: shot lengths match the locked beats, cuts land where planned (no extras), speech pace is readable. */
export function editChecks(o: { planned: number[]; detected: number[]; shotSeconds: number[]; beatSeconds: number[]; wordsPerShot: number[]; continuity: number | null }): Check[] {
  const near = (t: number) => o.planned.some((p) => Math.abs(p - t) <= 0.3);
  const extra = o.detected.filter((t) => !near(t)).length;
  const timing = o.shotSeconds.filter((s, i) => Math.abs(s - (o.beatSeconds[i] ?? s)) > 0.25).length;
  const fast = o.wordsPerShot.filter((w, i) => w / Math.max(0.5, o.shotSeconds[i] - 0.3) > 3.2).length;
  const checks: Check[] = [
    { name: "cuts where planned", score: clamp(10 - extra * 3), note: extra ? `${extra} unplanned cut${extra === 1 ? "" : "s"}` : `${o.detected.length} cuts, all on the beat`, by: "rules", weight: 1.5 },
    { name: "pacing vs script", score: clamp(10 - timing * 3), note: timing ? `${timing} shots off their beat length` : "Every shot matches its beat", by: "rules" },
    { name: "readable speech pace", score: clamp(10 - fast * 3), note: fast ? `${fast} shots over 3.2 words/s` : "Every line under 3.2 words/s", by: "rules" },
  ];
  if (o.continuity !== null) checks.push({ name: "continuity across cuts", score: o.continuity, note: "Same product, cast and set across shots", by: "judge", weight: 1.5 });
  return checks;
}

const Continuity = z.object({ errors: z.array(z.object({ severity: z.enum(["minor", "major"]), note: z.string().max(300) })).max(10) });

/**
 * One vision call over one frame per shot: do the product, cast, set and grade hold across cuts?
 * The judge lists errors and the score is computed from them: asked for a number, flash judges anchored on 7
 * even while writing "perfect continuity" (see PLAYBOOK §11).
 */
export async function judgeContinuity(model: string, frames: { at: number; url: string }[]) {
  const parts: Part[] = [
    { type: "text", text: `These are consecutive shots of one video ad, one frame per shot. List every continuity error between shots: the product changes (shape, color, label), a person changes (face, hair, clothes), the set, light or color grade jumps, or screen direction breaks. Different framing, angle or distance between shots is normal editing, not an error. Judge continuity only, not production value or realism. "major" = the product or a person changes, or the set is clearly different; "minor" = a slip most viewers wouldn't notice. Return JSON {"errors":[{"severity":"minor"|"major","note":string}]} with an empty list when there are none.` },
    ...frames.flatMap((f, i): Part[] => [{ type: "text", text: `Shot ${i + 1} (${f.at.toFixed(2)}s)` }, { type: "image_url", image_url: { url: f.url } }]),
  ];
  const { data, usage } = await chatJSON<unknown>(model, "You are a continuity supervisor. Return only JSON.", parts);
  const v = Continuity.safeParse(data);
  if (!v.success) return { score: null, notes: [] as string[], cost: usage.costUsd };
  return { score: continuityScore(v.data.errors), notes: v.data.errors.map((e) => `${e.severity}: ${e.note}`), cost: usage.costUsd };
}

export const continuityScore = (errors: { severity: "minor" | "major" }[]) =>
  clamp(10 - errors.filter((e) => e.severity === "minor").length * 1.5 - errors.filter((e) => e.severity === "major").length * 4);

// ---------- Gate runners (score, and the notes a retry should fix) ----------

/** Research gate. The judge is skipped (rules only) when it errors, so a judge outage never blocks research. */
export async function researchGate(model: string, r: Research, voc: VoiceOfCustomer | null | undefined, siteText: string, cal: JudgeCalibration | null, attempts = 1) {
  const checks = researchRules(r, voc);
  let cost = 0;
  let fixes: string[] = [];
  let unsupported: string[] = [];
  try {
    const j = await judgeResearch(model, r, siteText);
    checks.push(...j.checks);
    cost = j.cost;
    unsupported = j.unsupported;
    fixes = [...j.unsupported.map((u) => `Remove or source: ${u}`), ...j.notes];
  } catch (e) {
    fixes = [`Research judge unavailable: ${(e as Error).message.slice(0, 120)}`];
  }
  if (!r.competitors?.length) fixes.push("Name 2-4 real competitors in the category.");
  const score = stageScore("research", checks, model, attempts, fixes, cal);
  // An unsupported fact flows into the brief and every script, so it can't pass on a good average.
  if (unsupported.length && score.score >= threshold("research")) Object.assign(score, { score: threshold("research") - 0.5, pass: false });
  return { score, fixes, cost, unsupported };
}

/**
 * Deterministic last resort after a retry: drop every value prop, angle or competitor that contains a fact the
 * fact-checker couldn't find on the site, and cut those phrases out of the summary and audience.
 */
export function scrubResearch(r: Research, unsupported: string[]): Research {
  const bad = unsupported.map((u) => u.toLowerCase().replace(/^["“']|["”']$/g, "").trim()).filter((u) => u.length >= 4);
  const hit = (s: string) => bad.some((u) => s.toLowerCase().includes(u));
  const cut = (s: string) => bad.reduce((out, u) => out.replace(new RegExp(u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), "").replace(/\s{2,}/g, " ").replace(/\s+([,.;])/g, "$1").replace(/([,;])[,;]+/g, "$1"), s).trim();
  return {
    ...r,
    summary: cut(r.summary),
    audience: cut(r.audience),
    valueProps: r.valueProps.filter((v) => !hit(v)),
    angles: r.angles.filter((a) => !hit(a)),
    competitors: r.competitors?.filter((c) => !hit(`${c.name} ${c.difference ?? ""}`)),
  };
}

export async function shotsGate(model: string, shots: Shot[], cal: JudgeCalibration | null, attempts = 1) {
  const checks = shotRules(shots);
  let cost = 0;
  let fixes: string[] = [];
  try {
    const j = await judgeShots(model, shots);
    checks.push(...j.checks);
    cost = j.cost;
    fixes = j.fixes;
  } catch (e) {
    fixes = [`Shot judge unavailable: ${(e as Error).message.slice(0, 120)}`];
  }
  for (const c of checks) if (c.by === "rules" && c.score < 8) fixes.push(`${c.name}: ${c.note}`);
  return { score: stageScore("shots", checks, model, attempts, fixes, cal), fixes, cost };
}

type GateResult = { score: StageScore; fixes: string[]; cost: number };
/** Keeps the better of two attempts and records that a retry ran. */
export const better = <T extends GateResult>(a: T, b: T): T => {
  const best = b.score.score >= a.score.score ? b : a;
  return { ...best, score: { ...best.score, attempts: a.score.attempts + 1 }, cost: a.cost + b.cost };
};
