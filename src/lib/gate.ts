import { aiConfigured, chatJSON } from "./ai";
import { QA_PASS_SCORE } from "./pipeline";
import { MIN_DIVERSITY } from "./concepts";
import type { Brief, GateResult, Research } from "./types";

/** Checks every claim in the ad against known facts and confirms the brand's must-say items are present. */
export async function claimsCheck(
  model: string,
  o: { texts: string[]; research: Research; brief: Brief; offer?: string | null; mustSay?: string[] },
): Promise<{ data: { unsupported: string[]; missing: string[] }; cost: number }> {
  if (!aiConfigured()) return { cost: 0, data: { unsupported: [], missing: [] } };
  const { data, usage } = await chatJSON<{ unsupported: string[]; missing: string[] }>(
    model,
    "You are an ad compliance reviewer. Be precise: only flag concrete factual claims (prices, discounts, timings, guarantees, locations, statistics, awards, ingredients) that the facts do not support. Brand voice, opinions and emotional language are fine.",
    `Facts:\n- Research: ${JSON.stringify({ summary: o.research.summary, valueProps: o.research.valueProps })}\n- Offer: ${o.offer || o.brief.offer}\n- Brief: ${JSON.stringify(o.brief)}\nMust-say items: ${o.mustSay?.length ? o.mustSay.join(" | ") : "(none)"}\n\nAd text:\n${o.texts.filter(Boolean).join("\n")}\n\nReturn JSON: {"unsupported": string[] (each unsupported claim quoted, max 5), "missing": string[] (must-say items not present in meaning anywhere in the ad text)}`,
  );
  return { data: { unsupported: data.unsupported ?? [], missing: data.missing ?? [] }, cost: usage.costUsd };
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
