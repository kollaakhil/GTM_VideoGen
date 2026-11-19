import { z } from "zod";

/**
 * The shot sheet: the script enhanced into a director's table, and the single source of truth for a video. Previews,
 * the final, the edit and the editor instructions all read from it and nothing else (PLAYBOOK 14.1).
 */
export const ENGINES = ["blender", "ai_video", "remotion", "3d", "world"] as const;
export type Engine = (typeof ENGINES)[number];

export const TRANSITIONS = ["cut", "fade_black", "crossfade", "whip"] as const;

/** Blender scene templates in scripts/blender/shot_kit.py. Every one is a slow push-in on a black void. */
export const BLENDER_TEMPLATES = ["glow_word", "macro_label", "product_hero", "lab", "glb_turntable"] as const;
export type BlenderTemplate = (typeof BLENDER_TEMPLATES)[number];

const Str = (n: number) => z.string().trim().max(n);

export const ShotSchema = z.object({
  id: Str(24).min(1),
  n: z.number().int().min(1).max(60),
  start: z.number().min(0).max(120),
  end: z.number().min(0).max(120),
  shotType: Str(60).min(1),
  framing: Str(160).default(""),
  camera: z.object({ angle: Str(80).min(1), move: Str(120).min(1), lensMm: z.number().min(8).max(300) }),
  subject: Str(200).min(1),
  action: Str(300).default(""),
  lighting: Str(200).default(""),
  text: z.object({ copy: Str(140).min(1), placement: Str(80).default("lower third") }).nullable().default(null),
  audio: z.object({ vo: Str(300).nullable().default(null), sfx: Str(160).nullable().default(null), music: Str(160).nullable().default(null) }),
  transition: z.enum(TRANSITIONS).default("cut"),
  engine: z.enum(ENGINES),
  /** True when the operator picked the engine; routing never overrides it. */
  engineLocked: z.boolean().default(false),
  blender: z.object({ template: z.enum(BLENDER_TEMPLATES), word: Str(40).optional(), label: Str(60).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), ignite: z.number().min(-1).max(10).optional() }).optional(),
  /** Prompt for AI video / world shots (written by the enhancer from the row; editable). */
  prompt: Str(1200).optional(),
  editorNote: Str(300).default(""),
});
export type SheetShot = z.infer<typeof ShotSchema>;

export const RuleSchema = z.object({
  id: Str(32).min(1),
  text: Str(240).min(1),
  /** Machine-checkable rules the gate enforces deterministically; others are advisory notes for the final review. */
  check: z.enum(["push_in", "void_background", "foley_first", "fade_before_card", "action_cuts", "reveal_holds", "macro_open", "diegetic_text"]).optional(),
});
export type StyleRule = z.infer<typeof RuleSchema>;

export const SheetSchema = z.object({
  version: z.number().int().min(1),
  targetSec: z.number().min(6).max(60),
  aspect: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
  fps: z.number().int().min(12).max(60).default(24),
  audioMode: z.enum(["vo", "foley"]),
  bed: Str(200).default("low analog synth drone"),
  palette: Str(120).default(""),
  rules: z.array(RuleSchema).max(30),
  shots: z.array(ShotSchema).min(1).max(40),
  endCard: z.object({ title: Str(60).min(1), line: Str(120).default(""), footer: Str(120).default("") }),
});
export type ShotSheet = z.infer<typeof SheetSchema>;

export function parseSheet(input: unknown): { ok: true; sheet: ShotSheet } | { ok: false; error: string } {
  const r = SheetSchema.safeParse(input);
  if (!r.success) {
    const i = r.error.issues[0];
    return { ok: false, error: `${i?.path.join(".") || "sheet"}: ${i?.message ?? "invalid"}` };
  }
  return { ok: true, sheet: r.data };
}

export const dur = (s: Pick<SheetShot, "start" | "end">) => Number((s.end - s.start).toFixed(3));
