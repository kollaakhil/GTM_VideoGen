import type { AdScript, Research } from "./types";

/**
 * Jev gate: cheap yes/no pre-checks on a script through OpenRouter's Decisions API (typesafe/jev-1.13).
 * Jev returns probabilities, not reasons, so it only decides whether the full LLM judge needs to run.
 * Off unless JEV_GATES=1. Any failure returns null so callers fall back to the judge.
 * Docs: https://openrouter.ai/docs/guides/community/jev-tutorial
 */
export const JEV_URL = "https://openrouter.ai/api/alpha/decisions";
const JEV_MODEL = process.env.JEV_MODEL || "typesafe/jev-1.13";
/** Below this confidence on any question, escalate to the LLM judge. */
const JEV_MIN_CONFIDENCE = 0.8;

const jevEnabled = () => process.env.JEV_GATES === "1" && !!process.env.OPENROUTER_API_KEY;

type Noul = { type: "noul"; instructions: string; criteria: { true: string; false: string } };

/** Each question, and the answer that means "fine". */
const QUESTIONS: Record<string, { pass: boolean; q: Noul; problem: string }> = {
  hook_in_3s: {
    pass: true,
    problem: "The hook may not land in the first 3 seconds.",
    q: { type: "noul", instructions: "Does the first beat (the first 3 seconds) deliver a clear, attention-grabbing hook on its own?", criteria: { true: "Beat 1 states or shows the hook within its first 3 seconds.", false: "The hook is missing, late, or only makes sense after beat 1." } },
  },
  cta_clear: {
    pass: true,
    problem: "The CTA may be unclear.",
    q: { type: "noul", instructions: "Does the final beat say and show one clear call to action matching the CTA field?", criteria: { true: "The last beat has one unambiguous next action that matches the CTA.", false: "The CTA is missing, vague, or competes with another ask." } },
  },
  product_early: {
    pass: true,
    problem: "The product may not be named or shown early.",
    q: { type: "noul", instructions: "Is the product or brand named or clearly shown within the first two beats?", criteria: { true: "The product or brand appears in beat 1 or 2 (VO, on-screen text or visual).", false: "The product first appears later than beat 2 or not at all." } },
  },
  unsupported_claim: {
    pass: false,
    problem: "The script may contain a claim the product facts don't support.",
    q: { type: "noul", instructions: "Does the script make any factual claim, comparison with competitors, or superlative (only, best, #1, first, better than) that the product facts do not support?", criteria: { true: "At least one claim, comparison or superlative is not backed by the product facts.", false: "Every factual claim is backed by the product facts." } },
  },
};

interface JevAnswer { id: string; yes: number; confidence: number; ok: boolean; problem?: string }
export interface JevResult { answers: JevAnswer[]; escalate: boolean; reasons: string[]; cost: number; model: string }

/** Confidence for a yes/no answer: how far the probability sits from a coin flip, as max(p, 1 - p). */
const noulConfidence = (p: number) => Math.max(p, 1 - p);

function jevState(s: AdScript, research: Pick<Research, "brand" | "summary" | "valueProps">, offer?: string | null) {
  return {
    product_facts: JSON.stringify({ brand: research.brand, summary: research.summary, valueProps: research.valueProps, offer: offer ?? "" }),
    cta: s.cta,
    script: s.beats.map((b, i) => `Beat ${i + 1} (${b.seconds}s) visual: ${b.visual} | VO: ${b.vo} | on-screen: ${b.onScreen}`).join("\n"),
  };
}

/** Reads a Decisions API response into pass/escalate. Exported for tests. */
export function readJev(json: unknown): Omit<JevResult, "cost" | "model"> & { cost: number; model: string } {
  const j = json as { answers?: Record<string, { type?: string; noul?: number }>; usage?: { cost?: number }; model?: string };
  const answers: JevAnswer[] = Object.entries(QUESTIONS).map(([id, def]) => {
    const p = j.answers?.[id]?.noul;
    if (typeof p !== "number" || !Number.isFinite(p)) throw new Error(`Jev returned no answer for ${id}`);
    const confidence = noulConfidence(p);
    const ok = (p >= 0.5) === def.pass;
    return { id, yes: p, confidence, ok, ...(ok ? {} : { problem: def.problem }) };
  });
  const reasons = [
    ...answers.filter((a) => !a.ok).map((a) => a.problem!),
    ...answers.filter((a) => a.ok && a.confidence < JEV_MIN_CONFIDENCE).map((a) => `Jev unsure on ${a.id} (${a.confidence.toFixed(2)}).`),
  ];
  return { answers, escalate: reasons.length > 0, reasons, cost: Number(j.usage?.cost ?? 0), model: j.model ?? JEV_MODEL };
}

/** Runs the four script pre-checks in one Decisions call. Returns null when disabled or when the call fails. */
export async function jevScriptGate(s: AdScript, research: Pick<Research, "brand" | "summary" | "valueProps">, offer?: string | null): Promise<JevResult | null> {
  if (!jevEnabled()) return null;
  try {
    const res = await fetch(JEV_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json", "X-Title": "GTM Engine" },
      body: JSON.stringify({ model: JEV_MODEL, state: jevState(s, research, offer), questions: Object.fromEntries(Object.entries(QUESTIONS).map(([id, d]) => [id, d.q])) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Jev ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return readJev(await res.json());
  } catch (e) {
    console.warn("[jev] pre-check failed; falling back to the LLM judge:", (e as Error).message);
    return null;
  }
}
