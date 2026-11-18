import { aiConfigured, chatJSON } from "./ai";
import { QA_PASS_SCORE } from "./pipeline";
import { CLAIM_RULE } from "./ad-wisdom";
import { MIN_DIVERSITY } from "./concepts";
import type { AdScript, Brief, Direction, GateResult, Research } from "./types";
import { z } from "zod";

const Claims = z.object({ unsupported: z.array(z.string()), missing: z.array(z.string()) });

/** Checks every claim in the ad against known facts and confirms the brand's must-say items are present. */
export async function claimsCheck(
  model: string,
  o: { texts: string[]; research: Research; brief: Brief; offer?: string | null; mustSay?: string[] },
): Promise<{ data: { unsupported: string[]; missing: string[] }; cost: number }> {
  if (!aiConfigured()) return { cost: 0, data: { unsupported: [], missing: [] } };
  const { data, usage } = await chatJSON<unknown>(
    model,
    "You are an ad compliance reviewer. Be precise: only flag concrete factual claims (prices, discounts, timings, guarantees, locations, statistics, awards, ingredients) that the facts do not support, plus any comparison with competitors or superlative ('only', 'the only', 'unlike others', 'better than', 'best', '#1', 'first') the facts do not state. Brand voice, opinions and emotional language are fine.",
    `Facts:\n- Research: ${JSON.stringify({ summary: o.research.summary, valueProps: o.research.valueProps })}\n- Offer: ${o.offer || o.brief.offer}\n- Brief: ${JSON.stringify(o.brief)}\nMust-say items: ${o.mustSay?.length ? o.mustSay.join(" | ") : "(none)"}\n\nAd text:\n${o.texts.filter(Boolean).join("\n")}\n\nReturn JSON: {"unsupported": string[] (each unsupported claim quoted, max 5), "missing": string[] (must-say items not present in meaning anywhere in the ad text)}`,
  );
  return { data: Claims.parse(data), cost: usage.costUsd };
}

/** Creative Director Gate: QA >= pass bar, distinct from the rest of the set, no unsupported claims, all must-says present. */
export function gateVerdict(o: { qa: number; diversity: number | null; unsupported: string[]; missing: string[] }): GateResult {
  const reasons: string[] = [];
  if (o.qa < QA_PASS_SCORE) reasons.push(`QA ${o.qa}/10 is below ${QA_PASS_SCORE}`);
  if (o.diversity !== null && o.diversity < MIN_DIVERSITY) reasons.push(`Only ${Math.round(o.diversity * 100)}% distinct from the other ads`);
  for (const c of o.unsupported) reasons.push(`Unsupported claim: ${c}`);
  for (const m of o.missing) reasons.push(`Missing must-say: ${m}`);
  return { pass: reasons.length === 0, reasons, qa: o.qa, diversity: o.diversity, unsupported: o.unsupported, missing: o.missing };
}

const Rewrite = z.object({ headline: z.string() });

const words = (t: string) => t.toLowerCase().replace(/^\s*(headline|offer)\s*:\s*/i, "").match(/[\p{L}\p{N}$%#]+/gu) ?? [];

/** 0..1 overlap of a quoted claim with a line: 1 when one contains the other, else the share of claim words present. */
function claimOverlap(text: string, claim: string): number {
  const t = words(text);
  const c = words(claim);
  if (!t.length || !c.length) return 0;
  const tj = t.join(" ");
  const cj = c.join(" ");
  if (tj.includes(cj) || cj.includes(tj)) return 1;
  const ts = new Set(t);
  return c.filter((w) => ts.has(w)).length / c.length;
}

/** True when a quoted unsupported claim refers to this piece of copy. */
export function claimHits(text: string, claim: string): boolean {
  return claimOverlap(text, claim) >= 0.6;
}

/** Clips at the last whole word that fits. */
const clipWords = (t: string, max: number) => {
  const out: string[] = [];
  for (const w of t.replace(/\s+/g, " ").trim().split(" ")) {
    if ([...out, w].join(" ").length > max) break;
    out.push(w);
  }
  return out.join(" ");
};

export type Preflight = { headline: string; offer: string | null; unsupported: string[]; changes: string[]; cost: number };

/**
 * Runs the claims check on the on-image headline and offer BEFORE any image is paid for. Unsupported offer clauses are
 * dropped; an unsupported headline is rewritten once by the text model, re-checked, and replaced with a research value
 * prop if it still fails. Returns the copy that is safe to print.
 */
export async function preflightCopy(
  model: string,
  o: { headline: string; offer: string | null; research: Research; brief: Brief; offerTerms?: string | null },
): Promise<Preflight> {
  const same: Preflight = { headline: o.headline, offer: o.offer, unsupported: [], changes: [], cost: 0 };
  if (!aiConfigured()) return same;
  const check = (headline: string, offer: string | null) =>
    claimsCheck(model, { texts: [`Headline: ${headline}`, offer ? `Offer: ${offer}` : ""], research: o.research, brief: o.brief, offer: o.offerTerms });
  const first = await check(o.headline, o.offer);
  let cost = first.cost;
  const unsupported = first.data.unsupported;
  if (!unsupported.length) return { ...same, cost };
  const changes: string[] = [];
  const offerClaims = o.offer ? unsupported.filter((c) => claimHits(o.offer!, c) && !claimHits(o.headline, c)) : [];
  const headClaims = unsupported.filter((c) => !offerClaims.includes(c));

  let offer = o.offer;
  if (offer && offerClaims.length) {
    const kept = offer.split(/\s*,\s*/).filter((cl) => !offerClaims.some((c) => claimHits(cl, c)));
    offer = kept.length ? kept.join(", ") : null;
    changes.push(offer ? `Trimmed the offer to “${offer}” (unsupported: ${offerClaims.join("; ")})` : `Dropped the offer line (unsupported: ${offerClaims.join("; ")})`);
  }

  let headline = o.headline;
  if (headClaims.length) {
    const fallback = clipWords(o.research.valueProps.find((v) => v.trim()) ?? o.brief.insight, 40);
    let next = "";
    try {
      const { data, usage } = await chatJSON<unknown>(
        model,
        "You fix ad headlines that make claims the facts don't support. Keep the idea and the customer language; remove or soften only the unsupported part.",
        `Facts:\n- Research: ${JSON.stringify({ summary: o.research.summary, valueProps: o.research.valueProps })}\n- Offer: ${o.offerTerms || o.brief.offer}\nHeadline: ${o.headline}\nUnsupported claims: ${headClaims.join(" | ")}\nRule: ${CLAIM_RULE}\nReturn JSON: {"headline": string (max 40 chars, only facts above, no comparisons or superlatives unless stated above)}`,
      );
      cost += usage.costUsd;
      next = clipWords(Rewrite.parse(data).headline, 40);
      if (next) {
        const again = await check(next, offer);
        cost += again.cost;
        if (again.data.unsupported.some((c) => claimHits(next, c))) next = "";
      }
    } catch {
      next = "";
    }
    headline = next || fallback || o.headline;
    if (headline !== o.headline) changes.push(`Rewrote the headline “${o.headline}” → “${headline}” (unsupported: ${headClaims.join("; ")})`);
  }
  return { headline, offer, unsupported, changes, cost };
}

type Copy = NonNullable<Direction["copy"]>;
type Line = { where: string; text: string; field?: { key: "metaPrimaryText" | "metaHeadline" | "googleHeadlines" | "googleDescriptions"; index?: number; max: number } };

/** Every spoken and printed line of a script plus the ad's body copy, labeled by where it appears. */
function scriptLines(s: AdScript, copy?: Direction["copy"]): Line[] {
  const lines: Line[] = [];
  s.beats.forEach((b, i) => {
    if (b.vo.trim()) lines.push({ where: `beat ${i + 1} voiceover`, text: b.vo });
    if (b.onScreen.trim()) lines.push({ where: `beat ${i + 1} on-screen text`, text: b.onScreen });
  });
  if (copy) {
    if (copy.metaPrimaryText?.trim()) lines.push({ where: "primary text", text: copy.metaPrimaryText, field: { key: "metaPrimaryText", max: 500 } });
    if (copy.metaHeadline?.trim()) lines.push({ where: "Meta headline", text: copy.metaHeadline, field: { key: "metaHeadline", max: 40 } });
    copy.googleHeadlines?.forEach((t, i) => t.trim() && lines.push({ where: `Google headline ${i + 1}`, text: t, field: { key: "googleHeadlines", index: i, max: 30 } }));
    copy.googleDescriptions?.forEach((t, i) => t.trim() && lines.push({ where: `Google description ${i + 1}`, text: t, field: { key: "googleDescriptions", index: i, max: 90 } }));
  }
  return lines;
}

export type ScriptPreflight = { flags: { where: string; claim: string }[]; copy: Direction["copy"]; changes: string[]; unsupported: string[]; cost: number };

const Fixes = z.object({ fixes: z.record(z.string(), z.string()) });

/**
 * Claims preflight on the full script and the ad's body copy, before approval. Unsupported claims, comparisons and
 * superlatives in script lines are flagged (the operator edits them; they block HD). Flagged body copy is rewritten
 * once by the text model and re-checked; anything still unsupported stays flagged.
 */
export async function preflightScript(
  model: string,
  o: { script: AdScript; copy?: Direction["copy"]; research: Research; brief: Brief; offerTerms?: string | null },
): Promise<ScriptPreflight> {
  const none: ScriptPreflight = { flags: [], copy: o.copy, changes: [], unsupported: [], cost: 0 };
  if (!aiConfigured()) return none;
  const lines = scriptLines(o.script, o.copy);
  if (!lines.length) return none;
  const check = (ls: Line[]) => claimsCheck(model, { texts: ls.map((l) => `${l.where}: ${l.text}`), research: o.research, brief: o.brief, offer: o.offerTerms });
  const first = await check(lines);
  let cost = first.cost;
  const unsupported = first.data.unsupported;
  if (!unsupported.length) return { ...none, cost };
  const located = unsupported.flatMap((claim) => {
    // Attribute each claim to the line(s) it overlaps most, so one quote doesn't flag every line sharing a word.
    const scored = lines.map((l) => ({ l, o: claimOverlap(l.text, claim) }));
    const best = Math.max(0, ...scored.map((x) => x.o));
    const hits = best >= 0.6 ? scored.filter((x) => x.o === best).map((x) => x.l) : [];
    return hits.length ? hits.map((line) => ({ line, claim })) : [{ line: { where: "script", text: "" } as Line, claim }];
  });
  const copyHits = located.filter((h) => h.line.field);
  const flags = located.filter((h) => !h.line.field).map((h) => ({ where: h.line.where, claim: h.claim }));
  if (!copyHits.length || !o.copy) return { flags, copy: o.copy, changes: [], unsupported, cost };

  const copy: Copy = structuredClone(o.copy);
  const changes: string[] = [];
  const fixed = new Set<string>();
  const targets = [...new Map(copyHits.map((h) => [h.line.where, h.line])).values()];
  try {
    const { data, usage } = await chatJSON<unknown>(
      model,
      "You fix ad copy that makes claims the facts don't support. Keep the idea and customer language; remove or soften only the unsupported part.",
      `Facts:\n- Research: ${JSON.stringify({ summary: o.research.summary, valueProps: o.research.valueProps })}\n- Offer: ${o.offerTerms || o.brief.offer}\nRule: ${CLAIM_RULE}\nNo comparisons with competitors or superlatives unless stated in the facts.\nFix these lines:\n${targets.map((t) => `${t.where} (max ${t.field!.max} chars): ${t.text} | unsupported: ${copyHits.filter((h) => h.line.where === t.where).map((h) => h.claim).join("; ")}`).join("\n")}\nReturn JSON: {"fixes": {"<line label exactly as given>": "<fixed text>"}}`,
    );
    cost += usage.costUsd;
    const fixes = Fixes.parse(data).fixes;
    const rewritten = targets.flatMap((t) => {
      const next = clipWords(fixes[t.where] ?? "", t.field!.max);
      return next && next !== t.text ? [{ ...t, text: next, old: t.text }] : [];
    });
    const again = rewritten.length ? await check(rewritten) : null;
    cost += again?.cost ?? 0;
    for (const r of rewritten) {
      if (again!.data.unsupported.some((c) => claimHits(r.text, c))) continue;
      const f = r.field!;
      if (f.index === undefined) (copy[f.key] as string) = r.text;
      else (copy[f.key] as string[])[f.index] = r.text;
      fixed.add(r.where);
      changes.push(`Rewrote the ${r.where} “${r.old}” → “${r.text}”`);
    }
  } catch {
    // Keep the original copy flagged if the optional rewrite fails.
  }
  for (const h of copyHits) if (!fixed.has(h.line.where)) flags.push({ where: h.line.where, claim: h.claim });
  return { flags, copy, changes, unsupported, cost };
}
