import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateVideo } from "../ai";
import { packshotAvailable, renderPackshot } from "../packshot";
import { renderBlenderScene, sceneAvailable } from "./blender-scene";
import { motionGraphicsEnabled, renderEndCard } from "../motion-graphics";
import { kitJob, renderKit } from "./blender-kit";
import { RendererUnavailable, type Renderer, type RenderContext, type ShotRow } from "./types";

/** Which providers bill per second; the registry (builder B) can replace this. */
export const DEFAULT_PER_SEC = 0.12;

export interface AiVideoDeps {
  generate?: typeof generateVideo;
  /** USD per second at the context's resolution for a model. */
  pricePerSec?: (model: string) => number;
  defaultModel: string;
}

/** The provider aspect string for a render size. */
export const aspectOf = (w: number, h: number) => (w > h ? "16:9" : w < h ? "9:16" : "1:1");

/** AI video through the existing provider switch (fal, OpenRouter, Higgsfield). The caller owns the prompt. */
export function aiVideoRenderer(deps: AiVideoDeps): Renderer {
  const gen = deps.generate ?? generateVideo;
  const price = deps.pricePerSec ?? (() => DEFAULT_PER_SEC);
  const modelOf = (row: ShotRow) => (row.model && !/^(blender|remotion):/.test(row.model) ? row.model : deps.defaultModel);
  return {
    id: "ai-video",
    available: async () => true,
    estimateUsd: (row) => price(modelOf(row)) * row.seconds,
    async render(row, ctx) {
      if (!ctx.prompt) throw new RendererUnavailable("ai-video", "no prompt for this shot");
      const take = await gen(modelOf(row), ctx.prompt, { firstFrame: ctx.firstFrame, seconds: row.seconds, audio: false, resolution: ctx.resolution ?? "480p", aspect: aspectOf(ctx.width, ctx.height) });
      return { url: take.url, costUsd: take.usage.costUsd };
    },
  };
}

import { blenderQueue, type QueuePriority } from "./blender-queue";
import type { ChildProcess } from "node:child_process";

/** Context for a render job: includes queue metadata */
export interface RenderJobContext {
  jobId: string;
  runId: string;
  versionId: string;
  priority?: QueuePriority;
}

export interface BlenderDeps {
  /** Renders a clip of the product; defaults to the scene templates (and the legacy packshot for packshot rows). */
  clip?: (row: ShotRow, ctx: RenderContext, setProcess: (p: ChildProcess) => void) => Promise<string>;
  available?: () => Promise<boolean>;
  /** Job context for queue management */
  jobContext?: RenderJobContext;
}

async function defaultBlenderClip(row: ShotRow, ctx: RenderContext, setProcess: (p: ChildProcess) => void) {
  if (row.source === "packshot") {
    if (!(await packshotAvailable())) throw new RendererUnavailable("blender", "packshot scene not available");
    return renderPackshot(ctx.refs[0], { seconds: row.seconds + 0.2, width: ctx.width, height: ctx.height }, setProcess);
  }
  return renderBlenderScene(row, { mode: ctx.mode, width: ctx.width, height: ctx.height, image: ctx.refs[0] }, setProcess);
}

/** Enqueue a Blender job and execute when the slot is available */
async function withBlenderSlot<T>(
  ctx: RenderJobContext,
  shotId: string,
  fn: (setProcess: (p: ChildProcess) => void, setAbort: (c: AbortController) => void) => Promise<T>
): Promise<T> {
  const jobId = `${ctx.jobId}-${shotId}`;
  
  const started = await blenderQueue.enqueue({
    id: jobId,
    runId: ctx.runId,
    versionId: ctx.versionId,
    shotId,
    priority: ctx.priority ?? "normal",
  });

  if (!started) {
    throw new Error("Job was cancelled");
  }

  try {
    const result = await fn(
      (p) => blenderQueue.setProcess(jobId, p),
      (c) => blenderQueue.setAbortController(jobId, c)
    );
    blenderQueue.finish(jobId);
    return result;
  } catch (err) {
    blenderQueue.finish(jobId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/** Local Blender: free, and the real label is never redrawn. Missing Blender is "unavailable", so the router falls back. */
export function blenderRenderer(deps: BlenderDeps = {}): Renderer {
  return {
    id: "blender",
    available: deps.available ?? (async () => (await sceneAvailable()) || (await packshotAvailable())),
    estimateUsd: () => 0,
    async render(row, ctx) {
      const jobCtx = deps.jobContext;
      
      // Fallback for tests/CLI without queue context
      if (!jobCtx) {
        if (row.kit && !deps.clip) {
          const job = kitJob(row.kit.shot, { palette: row.kit.palette }, { width: ctx.width, height: ctx.height, mode: ctx.mode, blender: row.kit.blender });
          const image = row.kit.blender?.template === "product_hero" ? ctx.refs[0] : undefined;
          if (row.kit.blender?.template === "product_hero" && !image) throw new RendererUnavailable("blender", "product_hero needs a product photo");
          return { url: await renderKit(job, { mode: ctx.mode, image }, () => {}), costUsd: 0, note: `blender:${job.script === "scene_kit.py" ? "lab" : String(job.spec.template)}` };
        }
        if (!ctx.refs[0]) throw new RendererUnavailable("blender", "no product photo to unwrap the label from");
        return { url: await (deps.clip ?? defaultBlenderClip)(row, ctx, () => {}), costUsd: 0 };
      }

      // With queue context
      return withBlenderSlot(jobCtx, row.id, async (setProcess, setAbort) => {
        if (row.kit && !deps.clip) {
          const job = kitJob(row.kit.shot, { palette: row.kit.palette }, { width: ctx.width, height: ctx.height, mode: ctx.mode, blender: row.kit.blender });
          const image = row.kit.blender?.template === "product_hero" ? ctx.refs[0] : undefined;
          if (row.kit.blender?.template === "product_hero" && !image) throw new RendererUnavailable("blender", "product_hero needs a product photo");
          return { url: await renderKit(job, { mode: ctx.mode, image }, setProcess), costUsd: 0, note: `blender:${job.script === "scene_kit.py" ? "lab" : String(job.spec.template)}` };
        }
        if (!ctx.refs[0]) throw new RendererUnavailable("blender", "no product photo to unwrap the label from");
        return { url: await (deps.clip ?? defaultBlenderClip)(row, ctx, setProcess), costUsd: 0 };
      });
    },
  };
}

export interface RemotionDeps {
  card?: (row: ShotRow, ctx: RenderContext, out: string) => Promise<string>;
  enabled?: () => boolean;
}

/** Remotion cards (text, offer, end card), rendered locally and returned as an MP4 data URL. */
export function remotionRenderer(deps: RemotionDeps = {}): Renderer {
  const enabled = deps.enabled ?? motionGraphicsEnabled;
  return {
    id: "remotion",
    available: async () => enabled(),
    estimateUsd: () => 0,
    async render(row, ctx) {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gtm-card-"));
      try {
        const out = path.join(dir, "card.mp4");
        const c = ctx.card ?? { brand: row.onScreen ?? "" };
        const file = deps.card
          ? await deps.card(row, ctx, out)
          : await renderEndCard({ width: ctx.width, height: ctx.height, seconds: row.seconds, card: { brand: c.brand, line: c.line, cta: c.cta, footer: c.footer, bg: c.bg ?? "#0b0b0f", ink: c.ink ?? "white", logo: null, accent: c.accent ?? "#ffffff" } }, out);
        const data = await fs.readFile(file);
        return { url: `data:video/mp4;base64,${data.toString("base64")}`, costUsd: 0 };
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    },
  };
}

export const defaultRenderers = (ai: AiVideoDeps) => ({ "ai-video": aiVideoRenderer(ai), blender: blenderRenderer(), remotion: remotionRenderer() });
