import { chatJSON } from "./ai";
import type { AdScript, Brief, Direction, Research, ScriptHook, ScriptProofBrief, ScriptScore, StyleDNA, VoiceOfCustomer } from "./types";
import { SCRIPT_RUBRIC } from "./quality-policy";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { rehearseScript, rehearsalMetrics } from "./script-rehearsal";

export const SCRIPT_TARGET = 7;
export const WRITER = process.env.SCRIPT_WRITER_MODEL || "google/gemini-4-carbon";
const JUDGE = process.env.SCRIPT_JUDGE_MODEL || "openai/gpt-6.1-sol";
export const SCRIPT_WRITERS = ["google/gemini-4-carbon", "anthropic/claude-opus-5.5", "openai/gpt-6.1-sol", "openai/gpt-6-astra"] as const;
export const SCRIPT_JUDGES = ["openai/gpt-6.1-sol", "anthropic/claude-sonnet-5.5"] as const;
const LABELS: Record<string, string> = { "openai/gpt-6-astra": "Astra", "openai/gpt-6.1-sol": "Sol", "anthropic/claude-opus-5.5": "Opus 5.5", "anthropic/claude-sonnet-5.5": "Sonnet 5.5", "google/gemini-4-carbon": "Carbon" };
export const writerLabel = (m?: string) => LABELS[m ?? WRITER] ?? (m ?? WRITER).split("/").pop()!;
/** The judge is always a different model from the writer, so nobody grades their own work. */
export const judgeFor = (writer?: string, judge?: string) => {
  const w = writer ?? WRITER, j = judge ?? JUDGE;
  return j !== w ? j : [...SCRIPT_JUDGES, "google/gemini-4-carbon"].find((m) => m !== w)!;
};
const WORDS_PER_SEC = 2.5;
const HOOKS = {
  goal: "Goal first: show the person attempting something specific.",
  friction: "Buyer friction: open on a concrete obstacle to the goal.",
  proof: "Proof teased: show a real detail of the plan in motion without spoiling the outcome.",
} as const;

const STORY = "Goal → Stakes → Obstacle → Plan → Show the action and payoff → CTA. The audience should know what the person wants, why it matters to them, and what might stop them. Give a specific plan that makes the viewer want to see what happens, then actually show the result. Permit a goal and its stakes in the same beat; different roles can live in the VO while the visual shows one action. Keep stakes plausible, never invent a deadline, customer story, or product guarantee. For low-stakes products, use an everyday consequence.";

export type ScriptCtx = {
  direction: Pick<Direction, "title" | "hook" | "angle">;
  brief: Brief;
  research: Research;
  voc?: VoiceOfCustomer | null;
  style?: StyleDNA | null;
  rules?: string;
  mustSay?: string[];
  lengthSec: number;
  proof?: ScriptProofBrief;
};

const ONES: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const FILLER = new Set(["dollars", "dollar", "bucks", "percent", "and", "um", "uh"]);

/** Turns spoken numbers ("two ninety nine", "two hundred forty-nine") into digits so "$299" matches what Whisper hears. */
function numberize(tokens: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (!(t in ONES) && !(t in TENS)) { out.push(t); i++; continue; }
    let total = 0, cur = 0, lastSmall = false;
    while (i < tokens.length) {
      const w = tokens[i];
      if (w in ONES) { if (lastSmall && cur < 10 && ONES[w] >= 10) { cur = cur * 100 + ONES[w]; } else cur += ONES[w]; lastSmall = ONES[w] < 10; }
      else if (w in TENS) { cur = cur > 0 && cur < 10 ? cur * 100 + TENS[w] : cur + TENS[w]; lastSmall = false; }
      else if (w === "hundred") { cur = (cur || 1) * 100; lastSmall = false; }
      else if (w === "thousand") { total += (cur || 1) * 1000; cur = 0; lastSmall = false; }
      else if (w === "and" && i + 1 < tokens.length && (tokens[i + 1] in ONES || tokens[i + 1] in TENS)) { i++; continue; }
      else break;
      i++;
    }
    out.push(String(total + cur));
  }
  return out;
}

const words = (t: string) =>
  numberize(t.toLowerCase().replace(/[$,]/g, "").replace(/(\d)-(\d)/g, "$1 $2").replace(/[^a-z0-9%' ]+/g, " ").split(/\s+/).filter(Boolean))
    .map((w) => w.replace(/'/g, ""))
    .filter((w) => w && !FILLER.has(w));

function lev(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}

/** Same word, allowing transcription spelling drift on longer words (haldi/holdi, naamkaran/namkaran). */
const sameWord = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 4 && !/\d/.test(a + b) && lev(a, b) <= Math.max(1, Math.floor(Math.max(a.length, b.length) / 4)));
export const scriptText = (s: AdScript) => s.beats.map((b) => b.vo).filter(Boolean).join(" ");
export const scriptSeconds = (s: AdScript) => s.beats.reduce((t, b) => t + b.seconds, 0);

function lcs(x: string[], y: string[]): number {
  const dp = new Array(y.length + 1).fill(0);
  for (const xi of x) {
    let prev = 0;
    for (let j = 1; j <= y.length; j++) {
      const tmp = dp[j];
      dp[j] = sameWord(xi, y[j - 1]) ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[y.length];
}

/** Token-level similarity (LCS / longer length), 0..1. Used for speech-vs-script matching. */
export function textMatch(a: string, b: string): number {
  const x = words(a), y = words(b);
  if (!x.length && !y.length) return 1;
  if (!x.length || !y.length) return 0;
  return lcs(x, y) / Math.max(x.length, y.length);
}

/** Share of the expected words heard, in order, inside a longer transcript window (0..1). */
export function textRecall(heard: string, expected: string): number {
  const y = words(expected);
  if (!y.length) return 1;
  return lcs(words(heard), y) / y.length;
}

export const exactCopy = (text: string) => text.normalize("NFKC").toLowerCase()
  .replace(/[’']/gu, "").replace(/[^\p{L}\p{N}$%]+/gu, " ").trim();

export function sameSpeech(heard: string, expected: string) {
  const tokens = (text: string) => numberize(exactCopy(text.replace(/(\d),(?=\d)/g, "$1")
    .replace(/\$(\d+)/g, "$1 dollars").replace(/(\d+)\s*%/g, "$1 percent")).split(/\s+/).filter(Boolean))
    .map((w) => w === "dollar" || w === "bucks" ? "dollars" : w).join(" ");
  return tokens(heard) === tokens(expected);
}

const hasPhrase = (line: string, phrase: string) => {
  const matchCopy = (s: string) => exactCopy(s.normalize("NFKC").replace(/(\d)([.,])(?=\d)/g, (_, digit: string, separator: string) => `${digit}${separator === "." ? "decimalpoint" : ""}`)
    .replace(/(\d)\+/g, "$1 plus").replace(/£(?=\s?\d)/g, "pounds ").replace(/€(?=\s?\d)/g, "euros "));
  const expected = matchCopy(phrase);
  return !!expected && ` ${matchCopy(line)} `.includes(` ${expected} `);
};

/** Deterministic script checks: timing, read-aloud pace, hook length, CTA and must-say. */
export function checkScript(s: AdScript, lengthSec: number, mustSay: string[] = []): string[] {
  const out: string[] = [];
  const total = scriptSeconds(s);
  if (total !== lengthSec) out.push(`Runs ${total}s; target is ${lengthSec}s.`);
  if (s.beats.length < 2 || s.beats.some((b) => !b.visual.trim())) out.push("Provide a concrete visual for every beat.");
  s.beats.forEach((b, i) => {
    const n = words(b.vo).length;
    if (n > Math.ceil(b.seconds * WORDS_PER_SEC) + 1) out.push(`Beat ${i + 1} has ${n} words for ${b.seconds}s; max ${Math.ceil(b.seconds * WORDS_PER_SEC) + 1} at a natural pace.`);
  });
  if (words(s.hook.spoken).length > 12) out.push("Hook line is over 12 words; it must land in the first 1.5–3 seconds.");
  if (s.beats[0] && s.beats[0].seconds > 4) out.push("First beat is over 4s; the hook needs a cut by 3s.");
  const first = s.beats[0];
  if (first && (!exactCopy(s.hook.spoken) || exactCopy(first.vo) !== exactCopy(s.hook.spoken) || exactCopy(first.onScreen) !== exactCopy(s.hook.onScreen))) {
    out.push("Hook speech and on-screen text must match beat 1.");
  }
  const last = s.beats[s.beats.length - 1];
  if (!last || ![last.vo, last.onScreen].some((line) => hasPhrase(line, s.cta))) out.push("The exact CTA is not said or shown in the final beat.");
  const all = s.beats.flatMap((b) => [b.vo, b.onScreen]);
  for (const m of mustSay) if (exactCopy(m) && !all.some((line) => hasPhrase(line, m))) out.push(`Missing or shortened must-say; use it word for word: "${m}".`);
  if (s.proofBrief) {
    out.push(...rehearseScript(s));
    if (exactCopy(s.cta) !== exactCopy(s.proofBrief.cta)) out.push("Keep the exact CTA from the proof brief.");
    if (last && (!hasPhrase(last.onScreen, s.cta) || !hasPhrase(last.vo, s.cta))) out.push("Say and show the exact CTA in the final beat.");
    if (!first || first.seconds !== HOOK_SECONDS || first.visual !== s.hook.visual || first.vo !== s.hook.spoken || first.onScreen !== s.hook.onScreen) out.push("Keep the selected opening intact.");
    for (const term of s.proofBrief.offer.split("\n").map((x) => x.trim()).filter(Boolean)) {
      if (!all.some((line) => hasPhrase(line, term))) out.push(`Keep the exact offer term: "${term}".`);
    }
  }
  return out;
}

export const proofAssetUrl = (input: string) => {
  if (/^\/api\/media\/[\w./%-]+$/.test(input)) return input;
  try {
    const url = new URL(input);
    if (url.protocol === "https:" && !url.username && !url.password) return url.href;
  } catch {}
  return null;
};

const ctxBlock = (c: ScriptCtx) => `Concept (creative input, not evidence): ${JSON.stringify({ title: c.direction.title, angle: c.direction.angle })}
Brief: ${JSON.stringify(c.brief)}
Product facts (the only facts you may state): ${JSON.stringify({ brand: c.research.brand, summary: c.research.summary, valueProps: c.research.valueProps, audience: c.research.audience })}
Brand tone: ${c.research.tone}
Buyer objections (hypotheses, not quotes): ${JSON.stringify(c.voc?.objections ?? [])}
${c.proof ? `Proof brief (approved by the operator): ${JSON.stringify({ tension: c.proof.tension, claim: c.proof.claim, action: c.proof.action, offer: c.proof.offer, cta: c.proof.cta, buyerQuote: c.proof.quote?.text })}. ${c.proof.asset ? "The operator attached a reference; only use their description of it." : "No proof asset is attached. The action is a proposed scene, not existing footage or evidence of any new claim."}` : ""}${c.style ? `\nBorrowed style (structure and pacing only; never ${c.style.brand}'s name, slogans or claims): ${c.style.tone}; pacing ${c.style.pacing}` : ""}${c.rules ?? ""}${c.mustSay?.length ? `\nMust say (in VO or on-screen text): ${c.mustSay.join(" | ")}` : ""}`;

const SCRIPT_RULES = (len: number) => `Rules:
- Vertical 9:16 performance ad, ${len}s total. One buyer tension, one visible demonstration of a supported claim, one CTA. No extra storylines.
- Story: ${STORY}
- "vo": only the words spoken aloud, natural speech, max ${WORDS_PER_SEC} words per second of the beat. No speaker labels or stage directions.
- "onScreen": one readable message that fits the window; give mandatory terms their own time instead of shrinking or shortening them. Empty text is allowed.
- "visual": one filmable action per beat; never compress several setup steps into one. No invented text or signage in generated shots. Use only established product details.
- Only facts from the product facts and brief: never invent features, numbers, guarantees, timings, inclusions or customer testimonials.
- Say and show the exact CTA in the final beat.`;

const BeatCopy = z.object({ visual: z.string().trim().min(1).max(800), vo: z.string().trim().max(300), onScreen: z.string().trim().max(160) });
const Hook = z.object({
  type: z.enum(["goal", "friction", "proof"]),
  visual: BeatCopy.shape.visual,
  spoken: z.string().trim().min(1).max(120),
  onScreen: BeatCopy.shape.onScreen.nullish().transform((value) => value ?? ""),
});
const HookBatch = z.object({ hooks: z.array(z.unknown()).max(12) });
export const HOOK_SECONDS = 3;

function openingChecks(hook: Pick<ScriptHook, "spoken" | "onScreen">) {
  const m = rehearsalMetrics({ vo: hook.spoken, onScreen: hook.onScreen });
  const issues: string[] = [];
  if (!exactCopy(hook.spoken)) issues.push("The opening needs a spoken line.");
  if (words(hook.spoken).length > 8 || m.speakingSeconds > HOOK_SECONDS) issues.push("The spoken line is too long for 3 seconds. Use at most 8 short words.");
  if (!m.fits || m.readingSeconds > HOOK_SECONDS) issues.push("The overlay is too crowded for the opening.");
  return issues;
}

export async function draftHooks(writer: string, c: ScriptCtx, beforeRepair?: () => void) {
  const accepted = new Map<ScriptHook["type"], z.infer<typeof Hook>>();
  const types = Hook.shape.type.options;
  const issues: string[] = [];
  let cost = 0;

  const request = async (wanted: ScriptHook["type"][], repairNotes = "") => {
    const result = await chatJSON<unknown>(writer, "Write openings, not full scripts. Treat supplied facts as evidence and creative input as suggestions.", `${ctxBlock(c)}
Write exactly ${wanted.length} opening shot(s), one per requested type: ${wanted.map((type) => `${type}: ${HOOKS[type]}`).join(" ")}
${STORY}
Each opening must establish the goal and signal why it matters across its shot, line and overlay. Do not reveal the full payoff in the opening.
The shot must make sense on mute and earn attention in the first second. Show one moment in ${HOOK_SECONDS}s. Aim for 4–6 spoken words, never more than 8; speak naturally, not like a discount. Use a short overlay or set "onScreen" to "". Don't claim a customer experience, show an invented mechanism, or repeat the same opening under different labels.
${repairNotes}
Match this JSON shape, using the requested type keys exactly:
${JSON.stringify({ hooks: wanted.map((type) => ({ type, visual: "<one visible moment>", spoken: "<4–6 words>", onScreen: "" })) })}`);
    cost += result.usage.costUsd;
    const batch = HookBatch.safeParse(result.data);
    if (!batch.success) {
      issues.push("The writer did not return an openings list.");
      return;
    }
    for (const raw of batch.data.hooks) {
      const parsed = Hook.safeParse(raw);
      if (!parsed.success) {
        const field = parsed.error.issues[0]?.path[0];
        issues.push(`An opening had ${typeof field === "string" ? `an invalid "${field}" field` : "an invalid format"}.`);
        continue;
      }
      const h = parsed.data;
      if (!wanted.includes(h.type) || accepted.has(h.type)) continue;
      const note = !exactCopy(h.visual) ? "The shot description was empty." : openingChecks(h)[0];
      if (note) {
        issues.push(`${h.type}: ${note}`);
      } else if ([...accepted.values()].some((other) => exactCopy(other.visual) === exactCopy(h.visual) || exactCopy(other.spoken) === exactCopy(h.spoken))) {
        issues.push(`${h.type}: Use a different shot and spoken line.`);
      } else {
        accepted.set(h.type, h);
      }
    }
  };

  await request(types);
  const missing = types.filter((type) => !accepted.has(type));
  if (missing.length) {
    beforeRepair?.();
    try {
      await request(missing, `Fill missing types only. Do not repeat these accepted openings: ${JSON.stringify([...accepted.values()])}. Fix any relevant problems: ${[...new Set(issues)].slice(0, 6).join(" ")}`);
    } catch (error) {
      const detail = (error instanceof Error ? error.message : "").slice(0, 120);
      issues.push(`The repair request failed${detail ? `: ${detail}` : "."}`);
    }
  }
  const hooks = types.flatMap((type) => {
    const h = accepted.get(type);
    return h ? [{ ...h, id: randomUUID() }] : [];
  });
  return { hooks, cost, issues: [...new Set(issues)].slice(-5) };
}

export async function reviewHooks(judge: string, c: ScriptCtx, hooks: ScriptHook[]) {
  const result = await chatJSON<unknown>(judge, "Review ad openings independently; do not score imagined performance.", `${ctxBlock(c)}
Openings: ${JSON.stringify(hooks)}
Score on 0–10: distinct first shot, a goal and plausible stakes on mute, spoken specificity, and faithfulness to real product evidence. List blockers for unsupported claims, unfilmable proof, missing goal or stakes, spoiling the payoff, or an opening that only makes sense with sound. Return one review for each ID:
{"reviews":[{"id":"...","score":0,"note":"one concrete strength or fix","blockers":["..."]}]}.`);
  const schema = z.object({ reviews: z.array(z.object({
    id: z.string(), score: z.number().min(0).max(10), note: z.string().max(600), blockers: z.array(z.string().max(600)).max(6),
  })).length(hooks.length) });
  const reviews = schema.parse(result.data).reviews;
  const ranked = hooks.map((h) => {
    const matches = reviews.filter((r) => r.id === h.id);
    if (matches.length !== 1) throw new Error("Hook Lab needs an independent review of each opening.");
    const { score, note, blockers } = matches[0];
    const issues = [...blockers, ...openingChecks(h)];
    return { ...h, review: { score, note, blockers: issues } };
  });
  ranked.sort((a, b) => Number(!!a.review.blockers.length) - Number(!!b.review.blockers.length) || b.review.score - a.review.score);
  return { hooks: ranked, cost: result.usage.costUsd };
}

export function storyWindows(total: number) {
  const remaining = total - HOOK_SECONDS;
  const roles = remaining < 7 ? ["Name the obstacle and plan; show its action and visible result", "Exact CTA"]
    : remaining < 17 ? ["Obstacle, then a concrete plan", "Show the plan in action and its visible result", "Exact CTA"]
      : ["Obstacle", "Concrete plan", "Show the plan in action", "Reveal the visible result", "Exact CTA"];
  return roles.map((role, i) => ({ role, seconds: Math.floor(remaining / roles.length) + Number(i >= roles.length - remaining % roles.length) }));
}

/** Each script is graded in its own call so one malformed answer can't sink the batch. */
async function judgeScripts(judge: string, scripts: AdScript[], c: ScriptCtx): Promise<{ scores: ScriptScore[]; cost: number }> {
  const res = await Promise.all(scripts.map((s) => judgeBatch(judge, [s], c).catch(() => null)));
  const ok = res.filter((r) => r !== null);
  if (!ok.length) throw new Error("The script judge failed on every script");
  return { scores: res.map((r) => r?.scores[0] ?? { overall: 1, scores: {}, notes: ["The judge could not grade this script; rewrite or regrade it."], unsupported: [], panel: { stopRate: 0, quotes: [] } }), cost: ok.reduce((t, r) => t + r.cost, 0) };
}

const Rating = z.number().min(1).max(10);
const JudgeOutput = z.object({
  scores: z.array(z.object({
    id: z.string(),
    overall: Rating,
    scores: z.object({
      hook: Rating, clarity: Rating, specificity: Rating, customerLanguage: Rating, emotion: Rating,
      productEarly: Rating, cta: Rating, pacing: Rating, claims: Rating,
    }),
    notes: z.array(z.string()),
    unsupported: z.array(z.string()),
    blockerBeat: z.number().int().min(1).nullish(),
    proofProblems: z.array(z.string()).default([]),
  })),
});

async function judgeBatch(judge: string, scripts: AdScript[], c: ScriptCtx): Promise<{ scores: ScriptScore[]; cost: number }> {
  const { data, usage } = await chatJSON<unknown>(
    judge,
    "You independently review video scripts for production readiness. Grade the execution against the anchors, not against assumptions about the writer. Do not predict buyer behavior or ad performance.",
    `${ctxBlock(c)}
Scripts:
${JSON.stringify(scripts.map((s) => ({ id: s.id, framework: s.framework, hook: s.hook, beats: s.beats, cta: s.cta, rehearsal: checkScript(s, c.lengthSec, c.mustSay) })))}
Score each script 1–10 on: hook (clear and distinctive in 1.5s), clarity (one idea, instantly understood), specificity (concrete details, not generic ad-speak), customerLanguage (sounds like the intended buyer, not necessarily a quote), emotion, productEarly (product or result visible by 3s), cta (clear, motivating, matches the offer), pacing (fits ${c.lengthSec}s and the allotted beat lengths), claims (10 = every claim supported by the product facts).
"overall" is your honest weighted verdict (hook and specificity weigh most); any unsupported claim caps it at 6.
A spoken hook that is just a discount or promo line scores at most 5 on hook. Never tell the writer to move a promo line into the spoken hook.
Anchors: 7 = the offer is clear but one issue still hurts the ad (generic opening, rushed proof, or cluttered copy). 9 = a specific buyer tension lands on mute, a credible and filmable action proves the claim, the pacing leaves room for exact offer terms, and there is one clear next action. 10 = exceptional execution with no material improvement needed.
If there is a proof brief, list material "proofProblems" when the visual does not support the selected claim, contradicts narration, or crams multiple actions into too little time. Otherwise return []. Flag invented facts even if they appear in the concept or suggested proof scene.
If there is a proof brief, also check the required story: ${STORY} Put missing or out-of-order story steps in "proofProblems"; do not require a separate shot for each story step.
"notes": give only the biggest material blocker and one concrete, fact-supported fix. Return [] if there is none. "blockerBeat": 1-based beat to change, or omit when the problem is global or there is no blocker. Do not make up replacement claims.
"unsupported": each claim not backed by the product facts, quoted.
Return JSON: {"scores":[{"id","overall","scores":{"hook","clarity","specificity","customerLanguage","emotion","productEarly","cta","pacing","claims"},"notes","unsupported","blockerBeat","proofProblems"}]}`,
  );
  const parsed = JudgeOutput.safeParse(data);
  if (!parsed.success || parsed.data.scores.length !== scripts.length) throw new Error("Script review did not return a complete scorecard.");
  const byId = new Map(parsed.data.scores.map((s) => [s.id, s]));
  const scores = scripts.map((s) => {
    const r = byId.get(s.id);
    if (!r) throw new Error("Script review did not identify the approved script.");
    const unsupported = r.unsupported.slice(0, 5);
    return {
      overall: unsupported.length ? Math.min(6, r.overall) : r.proofProblems.length ? Math.min(SCRIPT_TARGET - 1, r.overall) : r.overall,
      scores: r.scores,
      notes: r.notes.length ? r.notes.slice(0, 1) : r.proofProblems.slice(0, 1),
      unsupported,
      proofProblems: r.proofProblems.slice(0, 6),
      blockerBeat: r.blockerBeat ?? undefined,
      panel: { stopRate: 0, quotes: [] },
    };
  });
  return { scores, cost: usage.costUsd };
}

/** Rank repair candidates without changing the displayed score. */
export const finalScore = (s: AdScript) => {
  const base = s.score?.overall ?? 0;
  const n = s.checks?.length ?? 0;
  return n ? Math.min(SCRIPT_TARGET - 1, base - Math.min(3, n)) : base;
};

export async function reviewScript(s: AdScript, c: ScriptCtx, writer: string, preferredJudge?: string) {
  const judge = judgeFor(writer, preferredJudge);
  const { scores, cost } = await judgeScripts(judge, [s], c);
  return { script: { ...s, score: scores[0], checks: checkScript(s, c.lengthSec, c.mustSay), review: { rubric: SCRIPT_RUBRIC, writer, judge, targetSeconds: c.lengthSec } }, cost };
}

/** Hooks that open the same way as a better-scored script in the set. */
export function sameHooks(list: AdScript[]): Set<string> {
  const out = new Set<string>();
  const open = (t: string) => words(t).slice(0, 2).join(" ");
  const ranked = [...list].sort((a, b) => finalScore(b) - finalScore(a));
  ranked.forEach((s, i) => {
    for (const t of ranked.slice(0, i)) {
      if (open(s.hook.spoken) === open(t.hook.spoken) || textMatch(s.hook.spoken, t.hook.spoken) >= 0.5) {
        out.add(s.id);
        break;
      }
    }
  });
  return out;
}

export async function scriptLab(c: ScriptCtx & { proof: ScriptProofBrief }, hook: ScriptHook, writer = WRITER, judge?: string) {
  const windows = storyWindows(c.lengthSec);
  const draft = await chatJSON<unknown>(writer, "Write a direct-response script from a chosen opening and real product proof.", `${ctxBlock(c)}
The first ${HOOK_SECONDS}s are locked: ${JSON.stringify({ visual: hook.visual, spoken: hook.spoken, onScreen: hook.onScreen })}.
Write exactly ${windows.length} following beats in this order. Do not repeat the opening.
${windows.map((b, i) => `Beat ${i + 2}, ${b.seconds}s: ${b.role}`).join("\n")}
${SCRIPT_RULES(c.lengthSec)}
Return {"beats":[{"visual":"...","vo":"...","onScreen":"..."}]}.`);
  const beats = z.object({ beats: z.array(BeatCopy).length(windows.length) }).parse(draft.data).beats;
  const initial: AdScript = {
    id: `sc_${randomUUID()}`, framework: HOOKS[hook.type].split(":")[0],
    proofBrief: c.proof, hook: { visual: hook.visual, spoken: hook.spoken, onScreen: hook.onScreen },
    beats: [{ seconds: HOOK_SECONDS, visual: hook.visual, vo: hook.spoken, onScreen: hook.onScreen }, ...beats.map((b, i) => ({ ...b, seconds: windows[i].seconds }))],
    cta: c.proof.cta,
  };
  const first = await reviewScript(initial, c, writer, judge);
  let cost = draft.usage.costUsd + first.cost;
  const score = first.script.score;
  const i = (score.blockerBeat ?? 0) - 1;
  const blocker = score.notes[0];
  if (score.overall >= SCRIPT_TARGET && !first.script.checks.length && !score.unsupported.length) return { script: first.script, cost };
  if (i < 1 || i >= initial.beats.length || !blocker) return { script: first.script, cost };

  try {
    const revision = await chatJSON<unknown>(writer, "Repair exactly one beat without adding facts or changing the selected hook.", `${ctxBlock(c)}
Script: ${JSON.stringify(initial.beats)}
Rewrite only beat ${i + 1}, with the same ${initial.beats[i].seconds}s window. Address this blocker: ${blocker}
Its story role: ${windows[i - 1].role}
${SCRIPT_RULES(c.lengthSec)}
Return {"visual":"...","vo":"...","onScreen":"..."} for that one beat.`);
    cost += revision.usage.costUsd;
    const revised = initial.beats.map((b, j) => j === i ? { ...b, ...BeatCopy.parse(revision.data) } : b);
    const second = await reviewScript({ ...initial, beats: revised, rounds: 1 }, c, writer, judge);
    cost += second.cost;
    const blockers = (s: AdScript) => (s.score?.unsupported.length ?? 0) + (s.score?.proofProblems?.length ?? 0) + (s.checks?.length ?? 0);
    if (blockers(second.script) <= blockers(first.script) && !second.script.score.unsupported.some((u) => !score.unsupported.includes(u)) &&
      (blockers(second.script) < blockers(first.script) || finalScore(second.script) > finalScore(first.script))) return { script: second.script, cost };
  } catch {
    // Keep the already graded draft if an optional repair fails.
  }
  return { script: first.script, cost };
}
