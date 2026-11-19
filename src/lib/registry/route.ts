import { routeShot } from "../render/router";
import type { RendererId } from "../render/types";
import { getModel, defaultFor } from "./index";
import { modelReady } from "./ready";
import { estimateUsd } from "./index";
import { classifyProduct, pickProductMeshModel } from "./product-3d";

/**
 * "Auto" model routing for the video stage. Which RENDERER a shot uses is builder C's `routeShot` (operator choice, model
 * prefix, packshot, graphic card, then product shots to Blender and live action to AI video); this adds the second half:
 * which MODEL inside that renderer. Product/label shots go to local Blender (free, label stays exact), text and end cards
 * to Remotion, people and live action to the best available video model for the mode.
 */
export interface AutoShot {
  id: string;
  seconds: number;
  action: string;
  camera: string;
  lensMm?: number;
  lighting?: string;
  graphic?: boolean;
  /** Operator's explicit model for this shot ("auto" or empty means decide). */
  model?: string;
  /** Sheet engine when the operator locked one. */
  engine?: "blender" | "ai_video" | "remotion" | "3d" | "world";
  engineLocked?: boolean;
  source?: "packshot";
}

export interface AutoContext {
  mode: "preview" | "final";
  hasProductRef: boolean;
  hasKeyframe: boolean;
  /** Per-shot spend ceiling in USD; models costing more are skipped. */
  maxShotUsd?: number;
  /** Test hook; production uses provider keys. */
  ready?: (id: string) => boolean;
  autoBlender?: boolean;
  /** The operator's pick for the product 3D asset step ("auto" or a registry id). */
  meshModel?: string;
  /** What the product is ("energy drink can", "running shoe"): only irregular products get a generated mesh. */
  productKind?: string;
}

/** People and live action: quality order for finals (realism, motion, audio) and the cheap order for previews. */
export const AUTO_RANK = {
  final: ["google/veo-3.1", "kwaivgi/kling-v3.0-pro", "bytedance/seedance-2.5", "bytedance/seedance-2.0", "google/veo-3.1-fast", "kling/v4/image-to-video", "hfmcp:kling3_0", "alibaba/wan-3.0-prime", "fal-ai/veo3.1/image-to-video", "fal-ai/kling-video/v3/pro/image-to-video", "bytedance/seedance-2.0-fast"],
  preview: ["bytedance/seedance-2.0-fast", "google/veo-3.1-lite", "kwaivgi/kling-v3.0-std", "bytedance/seedance-2.0-mini", "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video", "fal-ai/veo3.1/lite/image-to-video", "fal-ai/wan/v2.2-5b/image-to-video"],
} as const;

export interface AutoPick {
  renderer: RendererId;
  /** Registry id: a video model for ai-video, `blender:shot`, or `remotion:card`. */
  modelId: string;
  reason: string;
  usd: number;
  /** Blender product and hero shots import the real product mesh: the model that makes it and its one-time estimated cost (free when the cache already has it). */
  mesh?: { modelId: string; usd: number };
}

const RENDERER_ID: Record<RendererId, string> = { blender: "blender:shot", remotion: "remotion:card", "ai-video": "" };

export function pickVideoModel(shot: Pick<AutoShot, "seconds">, ctx: AutoContext): { id: string; reason: string } | null {
  const ready = ctx.ready ?? modelReady;
  const order = [...AUTO_RANK[ctx.mode], defaultFor("video")];
  for (const id of order) {
    const e = getModel(id);
    if (!e || !e.runnable || e.verify.source === "unverified" || !ready(id)) continue;
    if (!e.caps.t2v && !ctx.hasKeyframe) continue;
    if (!e.caps.i2v && ctx.hasKeyframe) continue;
    if (ctx.maxShotUsd !== undefined && estimateUsd(e, { seconds: shot.seconds }) > ctx.maxShotUsd) continue;
    return { id, reason: `${e.label}: best ${ctx.mode === "final" ? "quality" : "cost"} pick that is connected` };
  }
  return null;
}

/**
 * The product 3D asset a Blender shot needs. Primitive products (cans, bottles, boxes, tubes) and unclassified ones keep the
 * free procedural primitive with the label UV-wrapped, so no mesh is planned. Irregular products (shoes, toys, gadgets,
 * characters) get an Idol mesh: Max for finals, Turbo for previews under Auto. Undefined when not needed or none is connected.
 */
function meshPlan(ctx: AutoContext): { modelId: string; usd: number } | undefined {
  if (classifyProduct(ctx.productKind) !== "irregular") return undefined;
  try {
    const modelId = pickProductMeshModel(ctx.meshModel, ctx.ready ?? modelReady, ctx.mode);
    const e = getModel(modelId);
    return { modelId, usd: e ? estimateUsd(e) : 0 };
  } catch {
    return undefined;
  }
}

export function autoPick(shot: AutoShot, ctx: AutoContext): AutoPick {
  const explicit = shot.model && shot.model !== "auto" && !/^(blender|remotion):/.test(shot.model) ? shot.model : "";
  const engineRenderer: RendererId | undefined = shot.engineLocked ? ({ blender: "blender", remotion: "remotion", ai_video: "ai-video", "3d": "blender", world: "ai-video" } as const)[shot.engine ?? "ai_video"] : undefined;
  const routing = routeShot(
    { id: shot.id, beat: "", seconds: shot.seconds, action: shot.action, camera: shot.camera, lensMm: shot.lensMm, lighting: shot.lighting, graphic: shot.graphic, model: shot.model, source: shot.source, renderer: engineRenderer },
    { hasProductRef: ctx.hasProductRef, autoBlender: ctx.autoBlender ?? true },
  );
  const usd = (id: string) => { const e = getModel(id); return e ? estimateUsd(e, { seconds: shot.seconds }) : 0; };
  if (routing.renderer !== "ai-video") {
    const id = RENDERER_ID[routing.renderer];
    const mesh = routing.renderer === "blender" && ctx.hasProductRef ? meshPlan(ctx) : undefined;
    return { renderer: routing.renderer, modelId: id, reason: routing.reason, usd: 0, ...(mesh ? { mesh } : {}) };
  }
  if (explicit && getModel(explicit)?.stages.includes("video")) return { renderer: "ai-video", modelId: explicit, reason: "model chosen on the shot sheet", usd: usd(explicit) };
  const pick = pickVideoModel(shot, ctx);
  if (!pick) return { renderer: "ai-video", modelId: defaultFor("video"), reason: "no ranked model is connected; using the stage default", usd: usd(defaultFor("video")) };
  return { renderer: "ai-video", modelId: pick.id, reason: `${routing.reason}. ${pick.reason}`, usd: usd(pick.id) };
}
