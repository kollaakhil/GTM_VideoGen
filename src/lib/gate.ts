import { aiConfigured, chatJSON } from "./ai";
import { QA_PASS_SCORE } from "./pipeline";
import { CLAIM_RULE } from "./ad-wisdom";
import { MIN_DIVERSITY } from "./concepts";
import type { Brief, GateResult, Research } from "./types";
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

const words = (t: string) => t.toLowerCase().replace(/^\s*(headline|offer)\s*:\s*/i, "").match(/[a-z0-9$%#]+/g) ?? [];

/** True when a quoted unsupported claim refers to this piece of copy. */
export function claimHits(text: string, claim: string): boolean {
  const t = words(text);
  const c = words(claim);
  if (!t.length || !c.length) return false;
  const tj = t.join(" ");
  const cj = c.join(" ");
  if (tj.includes(cj) || cj.includes(tj)) return true;
  const ts = new Set(t);
  return c.filter((w) => ts.has(w)).length / c.length >= 0.6;
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
