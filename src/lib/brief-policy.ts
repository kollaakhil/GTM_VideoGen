import type { Brief } from "./types";

/**
 * Internal tasks and fine print that the brief writer sometimes lists as "mandatories" ("Confirm Vintage Cola is in
 * stock before launching", "Disclose: drinkolipop.com only, not combinable"). The script writer treats every
 * mandatory as must-show, so these ended up as VO ("Drinkolipop.com only, not combinable with other offers") and
 * even inside a shot description ("Prelaunch gate: confirm … in stock"). Mandatories must be things the ad shows or says.
 */
const OPERATIONAL = /\b(confirm|verify|check (that|stock|availability)|ensure|before (launch|launching|going live)|pre-?launch|hold (the )?launch|legal|compliance|approval|disclose|disclaimer|not combinable|terms apply|fine print|in stock)\b/i;

export const operationalMandatory = (m: string) => OPERATIONAL.test(m);

/**
 * "End card: 50% off 2+ cases, ends 11/30" and "Footer badge: Free shipping $50+ | 45-Day Money-Back Guarantee" are
 * delivered by the typeset end card in post, not by the writer. Left in the mandatories, the script judge docked every
 * script that did not cram them into the last overlay (run_8a9c7c9db627: "the final card drops the offer and omits the
 * mandatory footer", 7/10), while the overlay rule (≤7 words) made cramming them impossible.
 */
const END_CARD = /^\s*(end[\s-]?card|end slate|final card|footer( badge)?|badge|super)\s*[:\-–—]\s*/i;

export const endCardMandatory = (m: string) => END_CARD.test(m);

/** End-card copy from the brief: [offer line, footer], text after the label. */
export function endCardItems(b?: Pick<Brief, "mandatories"> | null): string[] {
  return (b?.mandatories ?? []).filter(endCardMandatory).map((m) => m.replace(END_CARD, "").replace(/^["“]|["”]$/g, "").trim()).filter(Boolean).slice(0, 2);
}

/** The brief as the creative writers see it: operational notes removed, end-card items moved to `endCard`. */
export function creativeBrief(b: Brief): Brief & { endCard?: string[] } {
  const endCard = endCardItems(b);
  return { ...b, mandatories: b.mandatories.filter((m) => !operationalMandatory(m) && !endCardMandatory(m)), ...(endCard.length ? { endCard } : {}) };
}
