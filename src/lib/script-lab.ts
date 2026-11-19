import { chatJSON } from "./ai";
import { text, texts } from "./judge-schema";
import { creativeBrief, endCardItems } from "./brief-policy";
import { GATE_THRESHOLDS } from "./gate-config";
import type { AdScript, Brief, Direction, Research, ScriptHook, ScriptProofBrief, ScriptScore, StyleDNA, Swipe, VoiceOfCustomer } from "./types";
import { SCRIPT_RUBRIC } from "./quality-policy";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { rehearseScript, rehearsalMetrics } from "./script-rehearsal";
import { styleTemplate } from "./script-styles";
import { jevScriptGate } from "./jev";

/** Script gate bar (default 8, NEXT_PUBLIC_GATE_THRESHOLDS="script=…"); the lab repairs until it clears it. */
export const SCRIPT_TARGET = GATE_THRESHOLDS.script;
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
  /** Operator-chosen script style id (see script-styles.ts); "auto" or absent adds nothing. */
  scriptStyle?: string | null;
  /** Saved swipe-file ads for this brand: the writer borrows structure, the judge scores inspiration match. */
  swipes?: Swipe[];
};

/** Inspiration ads with a readable structure (swipes) plus the reference style, if any. */
function inspirations(c: Pick<ScriptCtx, "swipes" | "style">) {
  const swipes = (c.swipes ?? []).filter((x) => x.structure).slice(0, 6).map((x) => ({
    format: x.structure!.format, hook: x.structure!.hook, beats: x.structure!.beats, whyItWorks: x.structure!.whyItWorks,
    ...(x.breakdown?.kind === "video" ? { measured: { seconds: x.breakdown.duration, shots: x.breakdown.shotCount, avgShotSec: x.breakdown.avgShotSec, firstCutSec: x.breakdown.firstCutSec, wordsPerSec: x.breakdown.wordsPerSec, pacing: x.breakdown.pacing, textStyle: x.breakdown.textStyle } } : {}),
  }));
  const style = c.style ? { tone: c.style.tone, pacing: c.style.pacing, hookPatterns: c.style.hookPatterns } : null;
  return swipes.length || style ? { swipes, style } : null;
}

const inspirationBlock = (c: ScriptCtx) => {
  const i = inspirations(c);
  return i?.swipes.length ? `\nInspiration ads (borrow hook shape, pacing and tone only; never their names, slogans or claims): ${JSON.stringify(i.swipes)}` : "";
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
  if (tokens(heard) === tokens(expected)) return true;
  // Domains and compounds: "drinkolipop.com" is heard as "drink olipop dot com"; compare without spaces or "dot".
  const collapsed = (text: string) => tokens(text.replace(/\.(?=[a-z])/gi, " dot ")).replace(/\bdot\b/g, "").replace(/\s+/g, "");
  return collapsed(heard) === collapsed(expected);
}

/**
 * Voice pre-check tolerance for lines that contain a web domain: speech-to-text routinely mishears coined brand
 * domains ("drinkolipop.com" → "drinkallapop.com"). Every word outside the domain must still match exactly, and the
 * domain may differ by at most 3 characters.
 */
export function nearSpeech(heard: string, expected: string) {
  if (sameSpeech(heard, expected)) return true;
  const domain = expected.match(/\b[a-z0-9-]+\.(com|co|io|ai|net|org|shop|store)\b/i)?.[0];
  if (!domain) return false;
  const [before, after] = expected.split(domain);
  const words = (t: string) => exactCopy(t).split(/\s+/).filter(Boolean);
  const h = words(heard.replace(/\.(?=[a-z])/gi, " dot ")).filter((w) => w !== "dot");
  const b = words(before), a = words(after.replace(/^\.?[a-z]*/i, ""));
  if (h.length < b.length + a.length + 1) return false;
  if (h.slice(0, b.length).join(" ") !== b.join(" ") || (a.length && h.slice(-a.length).join(" ") !== a.join(" "))) return false;
  const mid = h.slice(b.length, h.length - a.length).join("").replace(/(com|co|io|ai|net|org|shop|store)$/, "");
  const want = exactCopy(domain.replace(/\.[a-z]+$/i, "")).replace(/\s+/g, "");
  return levenshtein(mid, want) <= 3;
}

function levenshtein(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

const hasPhrase = (line: string, phrase: string) => {
  const matchCopy = (s: string) => exactCopy(s.normalize("NFKC").replace(/(\d)([.,])(?=\d)/g, (_, digit: string, separator: string) => `${digit}${separator === "." ? "decimalpoint" : ""}`)
    .replace(/(\d)\+/g, "$1 plus").replace(/£(?=\s?\d)/g, "pounds ").replace(/€(?=\s?\d)/g, "euros "));
  const expected = matchCopy(phrase);
  return !!expected && ` ${matchCopy(line)} `.includes(` ${expected} `);
};

/**
 * Scenes that need the video model to draw readable text: phone/app/web screens, product pages, signs, notifications,
 * quoted words. Image and video models turn these into garbled pseudo-text (OLIPOP hook: "a thumb taps a page showing
 * Out of Stock and Notify Me" → melting UI, video gate 4/10). Text belongs in the typeset overlay instead.
 */
const TEXT_SCENE = /\b(screens?|phones? screen|smartphone screen|app|apps|website|web ?page|product page|page|checkout|cart|ui|interface|notification|text message|dm|email|sign|signage|billboard|menu board|poster|banner|price tag|receipt|headline|caption|subtitle)\b|\b(showing|reads|reading|says|saying|labell?ed|titled|spelled)\s+["“'‘A-Z0-9]/;
export function renderedTextProblem(visual: string) {
  const hit = visual.match(TEXT_SCENE);
  const quoted = /["“][^"”]{2,}["”]/.test(visual);
  if (!hit && !quoted) return null;
  return `The visual asks the video model to show readable text or a screen ("${(hit?.[0] ?? "quoted words").trim()}"). Generated video garbles text and UI; show the product, hands and setting instead and put the words in the on-screen overlay.`;
}

/** Deterministic script checks: timing, read-aloud pace, hook length, CTA, must-say and no generated text/UI. */
export function checkScript(s: AdScript, lengthSec: number, mustSay: string[] = []): string[] {
  const out: string[] = [];
  const total = scriptSeconds(s);
  if (total !== lengthSec) out.push(`Runs ${total}s; target is ${lengthSec}s.`);
  if (s.beats.length < 2 || s.beats.some((b) => !b.visual.trim())) out.push("Provide a concrete visual for every beat.");
  s.beats.forEach((b, i) => {
    const n = words(b.vo).length;
    if (n > Math.ceil(b.seconds * WORDS_PER_SEC) + 1) out.push(`Beat ${i + 1} has ${n} words for ${b.seconds}s; max ${Math.ceil(b.seconds * WORDS_PER_SEC) + 1} at a natural pace.`);
  });
  s.beats.forEach((b, i) => {
    const t = renderedTextProblem(b.visual);
    if (t) out.push(`Beat ${i + 1}: ${t}`);
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
Brief: ${JSON.stringify(creativeBrief(c.brief))}
${endCardItems(c.brief).length ? `Post-production end card (typeset by the editor and held for 2.5s after the last beat, outside the beat runtime by design; already delivered, not part of your overlays or VO; the last beat does not need to repeat it): ${endCardItems(c.brief).join(" · ")}. Do not repeat it in overlays and do not count it as missing.\n` : ""}Product facts (the only facts you may state): ${JSON.stringify({ brand: c.research.brand, summary: c.research.summary, valueProps: c.research.valueProps, audience: c.research.audience })}
Brand tone: ${c.research.tone}
Buyer objections (hypotheses, not quotes): ${JSON.stringify(c.voc?.objections ?? [])}
${c.proof ? `Proof brief (approved by the operator): ${JSON.stringify({ tension: c.proof.tension, claim: c.proof.claim, action: c.proof.action, offer: c.proof.offer, cta: c.proof.cta, buyerQuote: c.proof.quote?.text })}. ${c.proof.asset ? "The operator attached a reference; only use their description of it." : "No proof asset is attached. The action is a proposed scene, not existing footage or evidence of any new claim."}` : ""}${c.style ? `\nBorrowed style (structure and pacing only; never ${c.style.brand}'s name, slogans or claims): ${c.style.tone}; pacing ${c.style.pacing}` : ""}${inspirationBlock(c)}${styleTemplate(c.scriptStyle)}${c.rules ?? ""}${c.mustSay?.length ? `\nMust say (in VO or on-screen text): ${c.mustSay.join(" | ")}` : ""}`;

const SCRIPT_RULES = (len: number) => `Rules:
- Vertical 9:16 performance ad, ${len}s total. One buyer tension, one visible demonstration of a supported claim, one CTA. No extra storylines.
- Story: ${STORY}
- "vo": only the words spoken aloud, natural speech, max ${WORDS_PER_SEC} words per second of the beat. No speaker labels or stage directions.
- "onScreen": one short message per beat (at most 7 words: one stat, one benefit or the CTA) that fits the window; give mandatory terms their own beat instead of stacking them. Empty text is allowed.
- "visual": one filmable action per beat; never compress several setup steps into one. Never show phones, screens, web pages, apps, notifications, signs or invented words in the scene (video models garble them); put words in "onScreen". The real product, with its real label as in the product photo, should be clearly visible and identifiable whenever it appears (never "unmarked" or generic packaging). Use only established product details.
- Every action you suggest in VO must agree with what the visual shows (do not say "tap" or "order" over a scene that shows something else).
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

function openingChecks(hook: Pick<ScriptHook, "spoken" | "onScreen"> & { visual?: string }) {
  const m = rehearsalMetrics({ vo: hook.spoken, onScreen: hook.onScreen });
  const issues: string[] = [];
  const t = hook.visual ? renderedTextProblem(hook.visual) : null;
  if (t) issues.push(t);
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
    id: z.string(), score: z.number().min(0).max(10), note: text(600), blockers: texts(6, 600),
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
      inspirationMatch: Rating.nullish(),
    }),
    notes: z.array(z.string()),
    unsupported: z.array(z.string()),
    blockerBeat: z.number().int().min(1).nullish(),
    proofProblems: z.array(z.string()).default([]),
  })),
});

/** Judge rule for the inspiration-match dimension, or "" when there is nothing to match (no penalty, no score). */
export function inspirationRule(c: Pick<ScriptCtx, "swipes" | "style">) {
  const i = inspirations(c);
  if (!i) return "";
  return `Also score "inspirationMatch" 1–10: how well the hook shape, pacing and tone match these inspirations (${JSON.stringify(i)}). Structure and feel only; copying their names, slogans or claims scores 1. Do not let inspirationMatch change "overall".`;
}

async function judgeBatch(judge: string, scripts: AdScript[], c: ScriptCtx): Promise<{ scores: ScriptScore[]; cost: number }> {
  const matchRule = inspirationRule(c);
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
If there is a proof brief, also check the required story: ${STORY} Put missing story steps in "proofProblems"; do not require a separate shot for each story step. Order is flexible: a "Buyer friction" opening may lead with the obstacle and a "Proof first" opening with the result, as long as the goal and stakes are clear by the end of beat 2. Do not flag that order as a problem.
"notes": give only the biggest material blocker and one concrete, fact-supported fix. Return [] if there is none. "blockerBeat": 1-based beat to change, or omit when the problem is global or there is no blocker. Do not make up replacement claims.
"unsupported": each claim not backed by the product facts, quoted.
${matchRule ? `${matchRule}\n` : ""}Return JSON: {"scores":[{"id","overall","scores":{"hook","clarity","specificity","customerLanguage","emotion","productEarly","cta","pacing","claims"${matchRule ? `,"inspirationMatch"` : ""}},"notes","unsupported","blockerBeat","proofProblems"}]}`,
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
      scores: Object.fromEntries(Object.entries(r.scores).filter(([k, v]) => typeof v === "number" && (k !== "inspirationMatch" || !!matchRule))) as Record<string, number>,
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

/**
 * Grades a script with the independent LLM judge. With JEV_GATES=1, a Jev pre-check runs first; when `prior` is a
 * clean full review (e.g. the same script before an operator edit), Jev is confident (>= 0.8) on every question and
 * flags nothing, the judge is skipped and the prior category scores are carried over. Otherwise the judge runs.
 */
export async function reviewScript(s: AdScript, c: ScriptCtx, writer: string, preferredJudge?: string, o: { prior?: AdScript | null } = {}) {
  const judge = judgeFor(writer, preferredJudge);
  const checks = checkScript(s, c.lengthSec, c.mustSay);
  const review = { rubric: SCRIPT_RUBRIC, writer, judge, targetSeconds: c.lengthSec };
  const g = await jevScriptGate(s, c.research, c.proof?.offer ?? c.brief.offer);
  const prior = o.prior?.score;
  const carry = !!g && !g.escalate && !!prior && !prior.unsupported.length && !prior.proofProblems?.length && !checks.length && o.prior?.review?.judge === judge;
  const gate = g ? {
    model: g.model, cost: g.cost, answers: g.answers, skippedJudge: carry,
    reasons: g.escalate ? g.reasons : carry ? [] : ["No earlier full review to carry; the judge grades it."],
  } : undefined;
  if (carry) {
    const score: ScriptScore = { ...prior!, notes: ["Jev pre-check passed with high confidence; category scores carried from the last full review."], unsupported: [], proofProblems: [] };
    return { script: { ...s, score, checks, review, gate }, cost: g!.cost };
  }
  const { scores, cost } = await judgeScripts(judge, [s], c);
  return { script: { ...s, score: scores[0], checks, review, ...(gate ? { gate } : {}) }, cost: cost + (g?.cost ?? 0) };
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
    proofBrief: c.proof, ...(c.scriptStyle && c.scriptStyle !== "auto" ? { style: c.scriptStyle } : {}), hook: { visual: hook.visual, spoken: hook.spoken, onScreen: hook.onScreen },
    beats: [{ seconds: HOOK_SECONDS, visual: hook.visual, vo: hook.spoken, onScreen: hook.onScreen }, ...beats.map((b, i) => ({ ...b, seconds: windows[i].seconds }))],
    cta: c.proof.cta,
  };
  const first = await reviewScript(initial, c, writer, judge);
  let cost = draft.usage.costUsd + first.cost;
  const score = first.script.score;
  if (score.overall >= SCRIPT_TARGET && !first.script.checks.length && !score.unsupported.length && !score.proofProblems?.length) return { script: first.script, cost };
  // One repair round that addresses every fix note at once: proof problems, unsupported claims, the judge's blocker and
  // deterministic checks. The old loop rewrote only `blockerBeat`, so global problems (no beat) and problems in a beat
  // other than the judge's single note were never fixed, and re-scores kept finding the same proof problems.
  const fixes = scriptFixNotes(first.script);
  if (!fixes.length) return { script: first.script, cost };
  const single = (score.blockerBeat ?? 0) - 1;
  const only = fixes.length === 1 && single >= 1 && single < initial.beats.length ? single : -1;
  // Beat 1's spoken line and overlay are the operator's chosen opening and stay locked, but its *visual* may be
  // repaired: problems in the opening shot ("unmarked can", "crams three actions into 3s") were unfixable before.
  const hookVisualFix = only < 0 && fixes.some((f) => /\b(beat 1|opening|first beat|hook)\b/i.test(f));
  const targets = only >= 1 ? [only] : initial.beats.map((_, j) => j).filter((j) => j >= 1);
  const record = (kept: boolean, reason: string, after?: number): AdScript["repair"] => ({ fixes, kept, reason, before: score.overall, after });
  try {
    const revision = await chatJSON<unknown>(writer, "Repair the script beats listed without adding facts or changing the locked opening line.", `${ctxBlock(c)}
Script: ${JSON.stringify(initial.beats)}
${hookVisualFix ? `Beat 1's "vo" and "onScreen" are locked; you may rewrite only its "visual". Return it as "openingVisual".\n` : "The opening (beat 1) is locked. "}Rewrite ${targets.length === 1 ? `only beat ${targets[0] + 1}` : `beats ${targets.map((j) => j + 1).join(", ")}`}, keeping each beat's seconds. Fix every one of these:
${fixes.map((f) => `- ${f}`).join("\n")}
Story roles: ${targets.map((j) => `beat ${j + 1}: ${windows[j - 1]?.role ?? "CTA"}`).join("; ")}
${SCRIPT_RULES(c.lengthSec)}
Return {${hookVisualFix ? `"openingVisual":"...",` : ""}"beats":[{"visual":"...","vo":"...","onScreen":"..."}]} with exactly ${targets.length} beat(s), in order.`);
    cost += revision.usage.costUsd;
    const Loose = z.object({ visual: z.string().trim().min(1).transform((t) => t.slice(0, 800)), vo: z.string().trim().transform((t) => t.slice(0, 300)), onScreen: z.string().trim().transform((t) => t.slice(0, 160)) });
    const parsed = z.object({ openingVisual: z.string().trim().min(1).optional(), beats: z.array(Loose) }).safeParse(revision.data);
    if (!parsed.success || parsed.data.beats.length !== targets.length) {
      console.warn("[script] repair returned an unusable shape", parsed.success ? `${parsed.data.beats.length} beats` : parsed.error.message.slice(0, 200));
      return { script: { ...first.script, repair: record(false, "The writer's repair came back in the wrong shape; kept the graded draft.") }, cost };
    }
    const out = parsed.data.beats;
    const openingVisual = hookVisualFix ? parsed.data.openingVisual?.slice(0, 800) : undefined;
    const revised = initial.beats.map((b, j) => targets.includes(j) ? { ...b, ...out[targets.indexOf(j)] } : j === 0 && openingVisual ? { ...b, visual: openingVisual } : b);
    const next: AdScript = { ...initial, beats: revised, rounds: 1, ...(openingVisual ? { hook: { ...initial.hook, visual: openingVisual } } : {}) };
    const second = await reviewScript(next, c, writer, judge, { prior: first.script });
    cost += second.cost;
    const kept = betterScript(second.script, first.script);
    const reason = kept ? `Repair kept: ${blockerCount(first.script)} → ${blockerCount(second.script)} blockers.` : `Repair discarded: ${blockerCount(second.script)} blockers and ${second.script.score.overall}/10 vs ${blockerCount(first.script)} and ${score.overall}/10 before.`;
    console.log(`[script] ${reason}`);
    return kept ? { script: { ...second.script, repair: record(true, reason, second.script.score.overall) }, cost } : { script: { ...first.script, repair: record(false, reason, second.script.score.overall) }, cost };
  } catch (e) {
    console.warn("[script] repair failed", (e as Error).message.slice(0, 200));
    return { script: { ...first.script, repair: record(false, `Repair failed: ${(e as Error).message.slice(0, 120)}`) }, cost };
  }
}

/** Everything the script gate wants fixed, deduplicated: deterministic checks first, then the judge's findings. */
export function scriptFixNotes(s: AdScript) {
  return [...new Set([
    ...(s.checks ?? []),
    ...(s.score?.unsupported ?? []).map((u) => `Remove or support this claim: ${u}`),
    ...(s.score?.proofProblems ?? []),
    ...(s.score?.notes ?? []),
  ])].slice(0, 8);
}

const blockerCount = (s: AdScript) => (s.score?.unsupported.length ?? 0) + (s.score?.proofProblems?.length ?? 0) + (s.checks?.length ?? 0);
/** Keep a repair only if it adds no new unsupported claim and has fewer blockers, or as many and a higher score. */
export function betterScript(next: AdScript, prev: AdScript) {
  if (next.score?.unsupported.some((u) => !prev.score?.unsupported.includes(u))) return false;
  const a = blockerCount(next), b = blockerCount(prev);
  return a < b || (a === b && finalScore(next) > finalScore(prev));
}

export type ScriptEdit = { hook?: string; hookOnScreen?: string; beats?: { vo: string; onScreen: string }[]; cta?: string };

const replaceCopy = (line: string, from: string, to: string) =>
  from.trim() ? line.replace(new RegExp(from.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), () => to) : line;

/**
 * Applies operator edits to a script: any beat, the hook (spoken and on-screen, kept in sync with beat 1) and the CTA
 * (swapped into the final beat and the script's proof brief, since the operator owns the brief). Pure; returns a copy.
 */
export function applyScriptEdit(sc: AdScript, edit?: ScriptEdit): AdScript {
  const next = structuredClone(sc);
  if (!edit) return next;
  edit.beats?.forEach((b, i) => {
    if (next.beats[i]) Object.assign(next.beats[i], { vo: b.vo, onScreen: b.onScreen });
  });
  const first = next.beats[0];
  if (first) {
    if (edit.hook !== undefined) first.vo = edit.hook;
    if (edit.hookOnScreen !== undefined) first.onScreen = edit.hookOnScreen;
    Object.assign(next.hook, { spoken: first.vo, onScreen: first.onScreen });
  }
  if (edit.cta !== undefined && edit.cta.trim() && edit.cta !== sc.cta) {
    const last = next.beats[next.beats.length - 1];
    if (last) {
      last.vo = replaceCopy(last.vo, sc.cta, edit.cta);
      last.onScreen = replaceCopy(last.onScreen, sc.cta, edit.cta);
    }
    next.cta = edit.cta;
    if (next.proofBrief) next.proofBrief = { ...next.proofBrief, cta: edit.cta };
  }
  return next;
}

export const scriptChanged = (a: AdScript, b: AdScript) => JSON.stringify([a.hook, a.beats, a.cta]) !== JSON.stringify([b.hook, b.beats, b.cta]);
