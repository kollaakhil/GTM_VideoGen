import type { Brief } from "./types";

/**
 * Internal tasks and fine print that the brief writer sometimes lists as "mandatories" ("Confirm Vintage Cola is in
 * stock before launching", "Disclose: drinkolipop.com only, not combinable"). The script writer treats every
 * mandatory as must-show, so these ended up as VO ("Drinkolipop.com only, not combinable with other offers") and
 * even inside a shot description ("Prelaunch gate: confirm … in stock"). Mandatories must be things the ad shows or says.
 */
const OPERATIONAL = /\b(confirm|verify|check (that|stock|availability)|ensure|before (launch|launching|going live)|pre-?launch|hold (the )?launch|legal|compliance|approval|disclose|disclaimer|not combinable|terms apply|fine print|in stock)\b/i;

export const operationalMandatory = (m: string) => OPERATIONAL.test(m);

/** The brief as the creative writers see it: operational notes removed from the mandatories. */
export function creativeBrief(b: Brief): Brief {
  return { ...b, mandatories: b.mandatories.filter((m) => !operationalMandatory(m)) };
}
