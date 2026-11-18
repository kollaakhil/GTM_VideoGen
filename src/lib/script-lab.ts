import { chatJSON } from "./ai";
import type { AdScript, Brief, Direction, Research, ScriptScore, StyleDNA, VoiceOfCustomer } from "./types";
import { vocBlock } from "./ad-wisdom";
import { SCRIPT_PASS, SCRIPT_RUBRIC } from "./quality-policy";
import { z } from "zod";
import { randomUUID } from "node:crypto";

export { SCRIPT_PASS } from "./quality-policy";
export const WRITER = process.env.SCRIPT_WRITER_MODEL || "google/gemini-4-carbon";
export const JUDGE = process.env.SCRIPT_JUDGE_MODEL || "openai/gpt-6.1-sol";
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
const MAX_ROUNDS = 2;

export const FRAMEWORKS = [
  { id: "pas", label: "Problem → agitation → solution", guide: "Name the pain in their words, twist the knife with a specific consequence, then reveal the product as the fix." },
  { id: "before_after", label: "Before → after", guide: "Show the frustrating before, a hard cut to the after with the product, then why it works." },
  { id: "hook_story_offer", label: "Hook → story → offer", guide: "A pattern-interrupt hook, a tiny relatable story, then the offer and CTA." },
  { id: "ugc", label: "UGC testimonial", guide: "First person, a real customer talking to camera, casual and specific, like a creator post, not an ad." },
  { id: "objection", label: "Objection first", guide: "Open with the top objection out loud, then dismantle it with facts from the research." },
  { id: "three_reasons", label: "Three reasons why", guide: "A bold claim, three fast numbered reasons with one visual each, then the CTA." },
] as const;

export const HOOK_LIST = ["result first (show a real, supported outcome)", "recognizable friction (show one concrete buyer frustration)", "proof up close (show the product doing something verifiable)", "visible contrast (show a fair and supported before/after)", "visual question (show a surprising incomplete action the ad then explains)", "human moment (show a distinctive, relatable action)"];
export const HOOK_TYPES = HOOK_LIST.map((h) => h.split(" (")[0]).join(", ");

export type ScriptCtx = {
  direction: Pick<Direction, "title" | "hook" | "angle">;
  brief: Brief;
  research: Research;
  voc?: VoiceOfCustomer | null;
  style?: StyleDNA | null;
  rules?: string;
  mustSay?: string[];
  lengthSec: number;
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
  const expected = exactCopy(phrase);
  return !!expected && ` ${exactCopy(line)} `.includes(` ${expected} `);
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
  return out;
}

const ctxBlock = (c: ScriptCtx) => `Concept: ${JSON.stringify(c.direction)}
Brief: ${JSON.stringify(c.brief)}
Product facts (the only facts you may state): ${JSON.stringify({ brand: c.research.brand, summary: c.research.summary, valueProps: c.research.valueProps, audience: c.research.audience })}
Brand tone: ${c.research.tone}${vocBlock(c.voc)}${c.style ? `\nBorrowed style (structure and pacing only; never ${c.style.brand}'s name, slogans or claims): ${c.style.tone}; pacing ${c.style.pacing}` : ""}${c.rules ?? ""}${c.mustSay?.length ? `\nMust say (in VO or on-screen text): ${c.mustSay.join(" | ")}` : ""}`;

const SCRIPT_SHAPE = `{"framework","hook":{"visual","spoken","onScreen"},"beats":[{"seconds","visual","vo","onScreen"}],"cta"}`;
const SCRIPT_RULES = (len: number) => `Rules:
- Vertical 9:16 performance ad, ${len}s total, 3–5 beats, each 2–6s; the sum of beat seconds equals ${len}.
- Beat 1 IS the hook: it stops the scroll in the first 1.5s, including on mute. Copy beat 1's voiceover and on-screen copy exactly into the hook fields. Hook types: ${HOOK_TYPES}.
- The spoken hook is a human line in the buyer's words (a pain, a desire, a surprising truth), never a promo or discount line. Even when the brief says to "lead with" an offer, show that offer as beat 1 "onScreen" text and say it in a later beat.
- "vo": only the words spoken aloud, natural speech, max ${WORDS_PER_SEC} words per second of the beat. No speaker labels or stage directions.
- "onScreen": concise text that works with sound off; never shorten mandatory offer wording. The overlay will be typeset in post.
- "visual": one concrete filmable scene an AI video model can render; same people and product across beats; never text, logos or signs in frame.
- Use the customer's exact phrases where they fit and answer the top objection.
- Only facts from the product facts and brief: never invent features, numbers, guarantees, timings, inclusions or customer testimonials.
- The final beat says and shows the CTA; "cta" is that line, max 40 chars.`;

type Raw = Omit<AdScript, "id">;
const clean = (r: Raw, id: string): AdScript => ({
  id,
  framework: String(r.framework ?? ""),
  hook: { visual: String(r.hook?.visual ?? ""), spoken: String(r.hook?.spoken ?? ""), onScreen: String(r.hook?.onScreen ?? "") },
  beats: (r.beats ?? []).slice(0, 6).map((b) => ({ seconds: Math.max(1, Math.min(8, Math.round(Number(b.seconds) || 3))), visual: String(b.visual ?? ""), vo: String(b.vo ?? ""), onScreen: String(b.onScreen ?? "") })),
  cta: String(r.cta ?? "").slice(0, 60),
});

export async function writeScripts(writer: string, c: ScriptCtx, count = 5): Promise<{ scripts: AdScript[]; cost: number }> {
  const fws = FRAMEWORKS.slice(0, Math.min(count, FRAMEWORKS.length));
  const res = await Promise.allSettled(
    fws.map((f, i) =>
      chatJSON<Raw>(
        writer,
        "You are a top direct-response video ad scriptwriter. You write scripts that stop the scroll, sound like real people and sell with specifics.",
        `${ctxBlock(c)}
Write one script for this concept using the framework "${f.label}": ${f.guide}
Open with a ${HOOK_LIST[i % HOOK_LIST.length]} hook.
${SCRIPT_RULES(c.lengthSec)}
Return JSON: ${SCRIPT_SHAPE} with "framework" set to "${f.label}".`,
      ),
    ),
  );
  const ok = res.flatMap((r, i) => (r.status === "fulfilled" ? [{ r: r.value, f: fws[i] }] : []));
  if (!ok.length) throw new Error(`The script writer failed: ${String((res[0] as PromiseRejectedResult).reason?.message ?? "").slice(0, 200)}`);
  const batch = randomUUID().slice(0, 8);
  return { scripts: ok.map(({ r, f }) => clean({ ...r.data, framework: f.label }, `sc_${f.id}_${batch}`)), cost: ok.reduce((t, x) => t + x.r.usage.costUsd, 0) };
}

/** Each script is graded in its own call so one malformed answer can't sink the batch. */
export async function judgeScripts(judge: string, scripts: AdScript[], c: ScriptCtx): Promise<{ scores: ScriptScore[]; cost: number }> {
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
    panel: z.object({ stopRate: z.number().min(0).max(10), quotes: z.array(z.string()) }),
  })),
});

async function judgeBatch(judge: string, scripts: AdScript[], c: ScriptCtx): Promise<{ scores: ScriptScore[]; cost: number }> {
  const { data, usage } = await chatJSON<unknown>(
    judge,
    "You are a ruthless creative director and performance marketer grading video ad scripts before any money is spent on production. You did not write them. Most first drafts deserve 5–7; reserve 9–10 for scripts you would bet budget on.",
    `${ctxBlock(c)}
Scripts:
${JSON.stringify(scripts.map(({ id, framework, hook, beats, cta }) => ({ id, framework, hook, beats, cta })))}
Score each script 1–10 on: hook (stops the scroll in 1.5s), clarity (one idea, instantly understood), specificity (concrete details, not generic ad-speak), customerLanguage (sounds like the buyer), emotion, productEarly (product or result visible by 3s), cta (clear, motivating, matches the offer), pacing (fits ${c.lengthSec}s, cuts every 2–4s), claims (10 = every claim supported by the product facts).
"overall" is your honest weighted verdict (hook and specificity weigh most); any unsupported claim caps it at 6.
A spoken hook that is just a discount or promo line scores at most 5 on hook; offers belong on screen in beat 1 and in later VO. Never tell the writer to move a promo line into the spoken hook.
"notes": up to 4 concrete rewrite instructions ("Replace X with Y"), not praise.
"unsupported": each claim not backed by the product facts, quoted.
"panel": simulate 10 buyers from the target audience seeing only the first 1.5s (hook visual + spoken + on-screen); "stopRate" = how many of 10 keep watching (0–10); "quotes" = 2 short honest reactions.
Return JSON: {"scores":[{"id","overall","scores":{"hook","clarity","specificity","customerLanguage","emotion","productEarly","cta","pacing","claims"},"notes","unsupported","panel":{"stopRate","quotes"}}]}`,
  );
  const parsed = JudgeOutput.safeParse(data);
  if (!parsed.success || parsed.data.scores.length !== scripts.length) throw new Error("Script review did not return a complete scorecard.");
  const byId = new Map(parsed.data.scores.map((s) => [s.id, s]));
  const scores = scripts.map((s) => {
    const r = byId.get(s.id);
    if (!r) throw new Error("Script review did not identify the approved script.");
    const unsupported = r.unsupported.slice(0, 5);
    return {
      overall: unsupported.length ? Math.min(6, r.overall) : r.overall,
      scores: r.scores,
      notes: r.notes.slice(0, 4),
      unsupported,
      panel: { stopRate: r.panel.stopRate, quotes: r.panel.quotes.slice(0, 2) },
    };
  });
  return { scores, cost: usage.costUsd };
}

/** Judge score adjusted for deterministic failures: one point per issue, capped below the pass bar. */
export const finalScore = (s: AdScript) => {
  const base = s.score?.overall ?? 0;
  const n = s.checks?.length ?? 0;
  return n ? Math.min(SCRIPT_PASS - 1, base - Math.min(3, n)) : base;
};

export async function reviewScript(s: AdScript, c: ScriptCtx, writer: string, preferredJudge?: string) {
  const judge = judgeFor(writer, preferredJudge);
  const { scores, cost } = await judgeScripts(judge, [s], c);
  return { script: { ...s, score: scores[0], checks: checkScript(s, c.lengthSec, c.mustSay), review: { rubric: SCRIPT_RUBRIC, writer, judge, targetSeconds: c.lengthSec } }, cost };
}

async function rewrite(writer: string, s: AdScript, c: ScriptCtx, extra: string[] = []): Promise<{ script: AdScript; cost: number }> {
  const fixes = [...extra, ...(s.score?.notes ?? []), ...(s.checks ?? []), ...(s.score?.unsupported ?? []).map((u) => `Remove unsupported claim: ${u}`)];
  const { data, usage } = await chatJSON<Raw>(
    writer,
    "You are a top direct-response video ad scriptwriter revising a script from a creative director's notes.",
    `${ctxBlock(c)}
Current script (${s.framework}): ${JSON.stringify({ hook: s.hook, beats: s.beats, cta: s.cta })}
Fix every note, keep the framework and what already works, make the hook sharper:
${fixes.map((f) => `- ${f}`).join("\n")}
${SCRIPT_RULES(c.lengthSec)}
Return JSON: ${SCRIPT_SHAPE}`,
  );
  return { script: { ...clean({ ...data, framework: s.framework }, s.id), rounds: (s.rounds ?? 0) + 1 }, cost: usage.costUsd };
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

const SAME_HOOK = "This hook opens like another script in the set. Write a completely different spoken hook (different hook type, different first words, different moment).";
/** One model writes, a different one judges (with a simulated audience panel), weak scripts are rewritten up to twice. */
export async function scriptLab(c: ScriptCtx, o: { writer?: string; judge?: string; count?: number; keep?: number } = {}): Promise<{ scripts: AdScript[]; cost: number }> {
  const writer = o.writer ?? WRITER, judge = judgeFor(writer, o.judge);
  const w = await writeScripts(writer, c, o.count ?? 5);
  let cost = w.cost;
  const grade = async (list: AdScript[]) => {
    if (!list.length) return;
    const j = await judgeScripts(judge, list, c);
    cost += j.cost;
    list.forEach((s, i) => Object.assign(s, { score: j.scores[i], checks: checkScript(s, c.lengthSec, c.mustSay), review: { rubric: SCRIPT_RUBRIC, writer, judge, targetSeconds: c.lengthSec } }));
  };
  let scripts = w.scripts.filter((s) => s.beats.length >= 2);
  if (!scripts.length) throw new Error("The script writer returned no usable scripts");
  await grade(scripts);
  const improve = async (weak: AdScript[], extra: (s: AdScript) => string[] = () => []) => {
    const redo = await Promise.all(weak.map((s) => rewrite(writer, s, c, extra(s))));
    cost += redo.reduce((t, r) => t + r.cost, 0);
    const fresh = redo.map((r) => r.script);
    await grade(fresh);
    scripts = scripts.map((s) => {
      const n = fresh.find((f) => f.id === s.id);
      return n && finalScore(n) >= finalScore(s) ? n : s;
    });
  };
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const dupes = sameHooks(scripts);
    const weak = [...scripts].sort((a, b) => finalScore(b) - finalScore(a))
      .filter((s) => finalScore(s) < SCRIPT_PASS || dupes.has(s.id)).slice(0, 2);
    if (!weak.length) break;
    await improve(weak, (s) => (dupes.has(s.id) ? [SAME_HOOK] : []));
  }
  scripts.sort((a, b) => finalScore(b) - finalScore(a) || (b.score?.panel.stopRate ?? 0) - (a.score?.panel.stopRate ?? 0));
  return { scripts: scripts.slice(0, o.keep ?? 3), cost };
}
