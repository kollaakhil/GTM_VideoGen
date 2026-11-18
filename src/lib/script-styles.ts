/**
 * Script styles the operator can pick at the Script checkpoint. Each one is a short structure template that is added to
 * the Script Lab writer prompt (openings and full scripts). "auto" adds nothing and lets the story framework decide.
 */
export const SCRIPT_STYLES = {
  auto: { label: "Auto", structure: "" },
  ugc_testimonial: {
    label: "UGC testimonial",
    structure: "First-person creator talking to a phone camera in a real room. Open on their own problem in their words, show them using the product, end on an honest, specific reaction and the CTA. Handheld, natural light; no studio polish. Never invent a customer story or result: the speaker describes only established product facts.",
  },
  problem_fix: {
    label: "Problem and fix",
    structure: "Open on the concrete problem as it happens. Show the product being used as the fix in one visible action, then the visible result. Problem → fix → result → CTA.",
  },
  founder_story: {
    label: "Founder story",
    structure: "The brand speaking as its maker: why the product exists, one design decision that addresses the buyer's tension, shown on the product itself, then the CTA. Use only the brand's own facts; no invented origin details, dates or people.",
  },
  demo_how_to: {
    label: "Demo or how-to",
    structure: "Hands-on demonstration. Each beat is one step of using the product, shown close up, with the VO naming the step. End on the finished result and the CTA.",
  },
  before_after: {
    label: "Before and after",
    structure: "Show the before state, a clear transition moment, then the after state with the product visible in both. Keep the change plausible and supported by product facts; never imply results the facts don't state.",
  },
  listicle: {
    label: "Listicle",
    structure: "A numbered list of 2–3 reasons, each one a supported product fact with its own beat and a numbered on-screen label (\"1.\", \"2.\", \"3.\"). The hook announces the list; the last beat is the CTA.",
  },
} as const;

export type ScriptStyleId = keyof typeof SCRIPT_STYLES;
export const SCRIPT_STYLE_IDS = Object.keys(SCRIPT_STYLES) as [ScriptStyleId, ...ScriptStyleId[]];

export const isScriptStyle = (id: unknown): id is ScriptStyleId => typeof id === "string" && id in SCRIPT_STYLES;

/** The prompt line for a style, or "" for auto / unknown ids. */
export function styleTemplate(id?: string | null): string {
  if (!isScriptStyle(id) || id === "auto") return "";
  const s = SCRIPT_STYLES[id];
  return `\nScript style (chosen by the operator): ${s.label}. Structure: ${s.structure} Keep the required story order and timing rules below; the style shapes how each beat is told.`;
}

export const styleLabel = (id?: string | null) => (isScriptStyle(id) ? SCRIPT_STYLES[id].label : SCRIPT_STYLES.auto.label);
