import type { StyleRule } from "@/lib/shot-sheet";

/**
 * Style rules from an inspiration video: its craft broken down into rules the sheet gate and final review can test
 * (PLAYBOOK 14.2). Known references carry a hand-verified rule pack; anything else is broken down by the vision
 * model and turned into rules by the text model.
 */
export const NEON_LAB_RULES: StyleRule[] = [
  { id: "r1", text: "Every shot is a slow continuous push-in.", check: "push_in" },
  { id: "r2", text: "Open on an extreme macro texture.", check: "macro_open" },
  { id: "r3", text: "Shallow depth of field on every close-up (long lens, wide aperture)." },
  { id: "r4", text: "Black void background.", check: "void_background" },
  { id: "r5", text: "Light comes from the practicals (the glowing elements) plus a rim light." },
  { id: "r6", text: "Specular highlights slide across metal and glass as the camera moves." },
  { id: "r7", text: "Desaturated, neutral scene; only the product colour pops." },
  { id: "r8", text: "Tactile imperfections: micro-scratches, dust, droplets." },
  { id: "r9", text: "Volumetric haze or vapour catches the glow." },
  { id: "r10", text: "Each loop goes detail, then trigger, then reveal." },
  { id: "r11", text: "Action cuts run 1–2 s.", check: "action_cuts" },
  { id: "r12", text: "Reveals hold 3–5 s.", check: "reveal_holds" },
  { id: "r13", text: "Hard cuts land on the action beat; foley first, no voiceover.", check: "foley_first" },
  { id: "r14", text: "Text is diegetic (in the scene) until the end card.", check: "diegetic_text" },
  { id: "r15", text: "Fade to black for at least 0.5 s before the end card.", check: "fade_before_card" },
];

const KNOWN: { re: RegExp; name: string; rules: StyleRule[] }[] = [
  { re: /x\.com\/sundarpichai\/status\/2123184309137965524|twitter\.com\/sundarpichai\/status\/2123184309137965524/i, name: "Gemini 4 Neon Blender MCP lab film (verified breakdown)", rules: NEON_LAB_RULES },
];

export function knownRules(url: string | null | undefined): { name: string; rules: StyleRule[] } | null {
  if (!url) return null;
  const k = KNOWN.find((x) => x.re.test(url));
  return k ? { name: k.name, rules: k.rules.map((r) => ({ ...r })) } : null;
}

/** Default rules when no inspiration is given: the generic craft floor every sheet should meet. */
export const BASE_RULES: StyleRule[] = [
  { id: "b1", text: "Every shot has a deliberate, slow camera move." },
  { id: "b2", text: "One idea per shot; the product is readable whenever it is on screen." },
  { id: "b3", text: "End on a clean card with the product name and where to get it." },
];

export const CHECKS = ["push_in", "void_background", "foley_first", "fade_before_card", "action_cuts", "reveal_holds", "macro_open", "diegetic_text"] as const;

export const RULES_PROMPT = `Turn this breakdown of an inspiration video into 8-15 concrete, testable craft rules for a new, original video in the same style (never copy its footage, people, lines or marks). Each rule is one sentence about camera, lens, light, colour, texture, pacing, sound, text or structure. When a rule matches one of these checks, tag it: ${CHECKS.join(", ")}.
Return JSON: {"rules":[{"text":"...","check":"push_in"|null}]}`;

export function cleanRules(raw: { text?: string; check?: string | null }[]): StyleRule[] {
  return raw
    .filter((r) => typeof r.text === "string" && r.text.trim())
    .slice(0, 15)
    .map((r, i) => ({ id: `r${i + 1}`, text: r.text!.trim().slice(0, 240), ...(CHECKS.includes(r.check as (typeof CHECKS)[number]) ? { check: r.check as (typeof CHECKS)[number] } : {}) }));
}
