import { z } from "zod";
import { SCRIPT_JUDGES, SCRIPT_WRITERS } from "@/lib/script-lab";
import { PRODUCT_PHOTO_PATTERN } from "@/lib/quality-policy";
import { SCRIPT_STYLE_IDS } from "@/lib/script-styles";
import { LENS_IDS, MUSIC_STYLE_IDS, VISUAL_STYLE_IDS } from "@/lib/video-looks";

const ModelId = z.string().max(120).regex(/^[\w./:-]+$/);

const Models = z.object({ text: ModelId, vision: ModelId, image: ModelId, video: ModelId }).partial().optional();

export const Ref = z.string().max(7_000_000).regex(PRODUCT_PHOTO_PATTERN, "Product photos must be PNG, JPEG or WebP");

const Refs = z.array(Ref).max(4).optional();

const Field = (n: number) => z.string().trim().min(1).max(n);

const ScriptOptions = {
  runId: z.string().max(64),
  directionId: z.string().max(32),
  lengthSec: z.number().int().min(6).max(30),
  writer: z.enum(SCRIPT_WRITERS).optional(),
  judge: z.enum(SCRIPT_JUDGES).optional(),
  style: z.enum(SCRIPT_STYLE_IDS).optional(),
};

/** Operator edits at the Script checkpoint: the hook (spoken and on-screen), any beat, and the CTA. */
const ScriptEdit = z.object({
  hook: z.string().trim().max(300).optional(),
  hookOnScreen: z.string().trim().max(160).optional(),
  beats: z.array(z.object({ vo: z.string().trim().max(300), onScreen: z.string().trim().max(160) })).max(6).optional(),
  cta: z.string().trim().min(1).max(60).optional(),
});

const BriefSchema = z.object({
  objective: Field(400),
  audience: Field(400),
  insight: Field(400),
  offer: Field(300),
  mandatories: z.array(Field(200)).min(1).max(8),
  kpi: Field(200),
});

/** One inspiration from the start screen: a link, or an uploaded video (≤ 30 MB) or image. */
const Inspiration = z.object({
  url: z.string().url().max(2048).optional(),
  upload: z.string().max(42_000_000).regex(/^data:(video\/(mp4|quicktime|webm)|image\/(png|jpeg|webp));base64,[A-Za-z0-9+/=]+$/, "Inspiration files must be MP4, MOV, WebM, PNG, JPEG or WebP").optional(),
  name: z.string().max(120).optional(),
}).refine((i) => !!i.url !== !!i.upload, "Each inspiration is either a link or a file");

const Plan = z.object({
  category: z.enum(["product_demo", "ugc_testimonial", "cinematic_lifestyle", "motion_graphics", "unboxing", "before_after", "problem_solution", "founder_story"]),
  lengthSec: z.number().int().min(4).max(60),
  draftModel: ModelId.optional(),
  finalModel: ModelId.optional(),
  voice: z.string().max(40).optional(),
  music: z.boolean().optional(),
  budgetUsd: z.number().min(0.5).max(500).optional(),
  lens: z.enum(LENS_IDS).optional(),
  visualStyle: z.enum(VISUAL_STYLE_IDS).optional(),
  musicStyle: z.enum(MUSIC_STYLE_IDS).optional(),
  takes: z.number().int().min(1).max(3).optional(),
  realSet: z.boolean().optional(),
});

export const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("research"), brandUrl: z.string().url().max(2048), goal: Field(500).refine((g) => g.length >= 3, "Goal is too short"), format: z.enum(["static", "video"]), referenceUrl: z.string().url().max(2048).optional().or(z.literal("")), offer: z.string().trim().max(600).optional(), models: Models, inspirations: z.array(Inspiration).max(4).optional(), autoBrief: z.boolean().optional() }),
  z.object({ action: z.literal("brief"), runId: z.string().max(64) }),
  z.object({ action: z.literal("edit_brief"), runId: z.string().max(64), brief: BriefSchema }),
  z.object({ action: z.literal("directions"), runId: z.string().max(64), format: z.enum(["static", "video"]).optional() }),
  z.object({ action: z.literal("generate"), runId: z.string().max(64), refs: Refs }),
  z.object({ action: z.literal("organic"), runId: z.string().max(64) }),
  z.object({ action: z.literal("concepts"), runId: z.string().max(64), format: z.enum(["static", "video"]).optional() }),
  z.object({ action: z.literal("pick_concepts"), runId: z.string().max(64), ids: z.array(z.string().max(16)).min(1).max(5) }),
  z.object({ action: z.literal("cancel"), runId: z.string().max(64) }),
  z.object({ action: z.literal("storyboard"), runId: z.string().max(64), directionId: z.string().max(32).optional(), plan: Plan, refs: Refs }),
  z.object({ action: z.literal("save_storyboard_photos"), runId: z.string().max(64), refs: z.array(Ref).min(1).max(4) }),
  z.object({ action: z.literal("draft_hooks"), ...ScriptOptions, proof: z.object({
    tension: Field(400), claim: Field(800), action: Field(500), asset: z.string().trim().max(2048).or(Ref).optional(), offer: z.string().trim().max(400), cta: Field(40),
    quoteIndex: z.number().int().min(0).max(7).optional(),
  }) }),
  z.object({ action: z.literal("write_scripts"), ...ScriptOptions, hookId: z.string().uuid() }),
  z.object({
    action: z.literal("approve_script"),
    runId: z.string().max(64),
    directionId: z.string().max(32),
    scriptId: z.string().max(64),
    edit: ScriptEdit.optional(),
  }),
  z.object({ action: z.literal("rescore_script"), runId: z.string().max(64), directionId: z.string().max(32), scriptId: z.string().max(64), edit: ScriptEdit.optional() }),
  z.object({ action: z.literal("redo_shot"), runId: z.string().max(64), directionId: z.string().max(32), shotId: z.string().max(8), visual: z.string().trim().min(5).max(800).optional(), refs: Refs }),
  z.object({ action: z.literal("render_video"), runId: z.string().max(64), directionId: z.string().max(32), tier: z.enum(["draft", "final"]), refs: Refs, draftModel: z.string().max(120).optional(), finalModel: z.string().max(120).optional(), takes: z.number().int().min(1).max(3).optional(), acceptWarnings: z.boolean().optional() }),
  z.object({ action: z.literal("shot_settings"), runId: z.string().max(64), directionId: z.string().max(32), shotId: z.string().max(8), model: ModelId.optional(), lens: z.enum(LENS_IDS).optional() }),
  z.object({ action: z.literal("approve_take"), runId: z.string().max(64), directionId: z.string().max(32), takeId: z.string().max(64) }),
  z.object({ action: z.literal("override_stage"), runId: z.string().max(64), key: z.string().regex(/^(research|shots|video|audio|edit)(:[A-Za-z0-9_-]{1,32})?$/), reason: z.string().trim().min(3).max(300) }),
  z.object({ action: z.literal("calibrate_judges"), runId: z.string().max(64) }),
  z.object({ action: z.literal("regenerate"), runId: z.string().max(64), directionId: z.string().max(32), refs: Refs }),
]);

export type Parsed = z.infer<typeof Body>;
