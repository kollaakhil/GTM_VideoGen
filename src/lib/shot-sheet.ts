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

const Str = (n: number, min = 0) =>
  z.preprocess(
    (val) => {
      if (typeof val !== "string") return val;
      const s = val.trim();
      if (s.length <= n) return s;
      const cut = s.slice(0, n);
      const lastSpace = cut.lastIndexOf(" ");
      return lastSpace > 0 ? cut.slice(0, lastSpace) + "…" : cut.slice(0, n - 1) + "…";
    },
    min > 0 ? z.string().min(min) : z.string()
  );

export const ShotSchema = z.object({
  id: Str(24, 1),
  n: z.number().int().min(1).max(60),
  start: z.number().min(0).max(120),
  end: z.number().min(0).max(120),
  shotType: Str(60, 1),
  framing: Str(240).default(""),
  camera: z.object({ angle: Str(80, 1), move: Str(120, 1), lensMm: z.number().min(8).max(300) }),
  subject: Str(200, 1),
  action: Str(300).default(""),
  lighting: Str(200).default(""),
  text: z.object({ 
    copy: Str(140, 1), 
    placement: Str(80).default("lower third"),
    /** Caption chunks (2-4 words each) for patterns that specify chunking. */
    chunks: z.array(Str(30)).optional()
  }).nullable().default(null),
  audio: z.object({ vo: Str(300).nullable().default(null), sfx: Str(160).nullable().default(null), music: Str(160).nullable().default(null) }),
  transition: z.enum(TRANSITIONS).default("cut"),
  engine: z.enum(ENGINES),
  /** True when the operator picked the engine; routing never overrides it. */
  engineLocked: z.boolean().default(false),
  blender: z.object({ template: z.enum(BLENDER_TEMPLATES), word: Str(40).optional(), label: Str(60).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), ignite: z.number().min(-1).max(10).optional() }).optional(),
  /** Prompt for AI video / world shots (written by the enhancer from the row; editable). */
  prompt: Str(1200).optional(),
  editorNote: Str(400).default(""),
  /** Story pattern beat/role (optional, so existing sheets still parse). */
  beat: Str(40).optional(),
});
export type SheetShot = z.infer<typeof ShotSchema>;

export const RuleSchema = z.object({
  id: Str(32, 1),
  text: Str(240, 1),
  /** Machine-checkable rules the gate enforces deterministically; others are advisory notes for the final review. */
  check: z.enum([
    "push_in", "void_background", "foley_first", "fade_before_card", "action_cuts", "reveal_holds", "macro_open", "diegetic_text",
    // Confession loop pattern checks
    "setup_cuts", "long_takes", "cutaway_cadence", "caption_chunks", "vo_pacing", "no_music", 
    "silence_gap", "closeup_wide", "echo_opening", "no_cta", "beats_present"
  ]).optional(),
});
export type StyleRule = z.infer<typeof RuleSchema>;

export const SheetSchema = z.object({
  version: z.number().int().min(1),
  targetSec: z.number().min(6).max(60),
  aspect: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
  fps: z.number().int().min(12).max(60).default(24),
  audioMode: z.enum(["vo", "foley"]),
  bed: Str(200).default(""),
  palette: Str(120).default(""),
  rules: z.array(RuleSchema).max(30),
  shots: z.array(ShotSchema).min(1).max(40),
  endCard: z.object({ title: Str(60, 1), line: Str(120).default(""), footer: Str(120).default("") }),
  /** Story pattern ID (optional, defaults to confession_loop). */
  patternId: Str(40).optional(),
});
export type ShotSheet = z.infer<typeof SheetSchema>;

export function parseSheet(input: unknown): { ok: true; sheet: ShotSheet } | { ok: false; error: string } {
  const r = SheetSchema.safeParse(input);
  if (!r.success) {
    const i = r.error.issues[0];
    const path = i?.path.join(".") || "sheet";
    let message = i?.message ?? "invalid";
    
    // Make common Zod errors more readable
    if (i?.code === "too_big" && "maximum" in i && typeof i.maximum === "number") {
      const field = path.split(".").pop() || "field";
      message = `${field} is too long (max ${i.maximum})`;
    } else if (i?.code === "too_small" && "minimum" in i && typeof i.minimum === "number" && i.minimum > 0) {
      const field = path.split(".").pop() || "field";
      message = `${field} is required`;
    } else if (i?.code === "invalid_type" && "expected" in i && "received" in i && i.expected === "string" && i.received === "undefined") {
      const field = path.split(".").pop() || "field";
      message = `${field} is required`;
    } else if (i?.code === "invalid_union" && message.includes("Invalid enum value")) {
      const field = path.split(".").pop() || "field";
      message = `${field} has an invalid value`;
    }
    
    return { ok: false, error: `${path}: ${message}` };
  }
  return { ok: true, sheet: r.data };
}

export const dur = (s: Pick<SheetShot, "start" | "end">) => Number((s.end - s.start).toFixed(3));
