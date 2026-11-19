/**
 * Render pipeline types. A `ShotRow` is the minimal slice of a shot-sheet row the renderers need; builder A owns the
 * full shot-sheet type, so everything here codes against this small interface and `rowFromShot` adapts today's `Shot`.
 */
import type { Shot } from "../types";

export type RendererId = "blender" | "ai-video" | "remotion";
export type RenderMode = "preview" | "final";
export type BlenderTemplateId = "push-in" | "orbit" | "macro" | "rack-focus";

export interface ShotRow {
  id: string;
  beat: string;
  seconds: number;
  /** What happens in the shot (the sheet's action column). */
  action: string;
  /** Free-text camera column ("slow push-in, 85mm"). */
  camera: string;
  lensMm?: number;
  lighting?: string;
  onScreen?: string;
  /** Sound for this beat (foley / sfx description). */
  sound?: string;
  /** Operator's choice; "auto" or undefined lets the router decide. */
  renderer?: RendererId | "auto";
  /** Provider model id for ai-video ("fal:seedance..."), or "blender:..." / "remotion:..." prefixes. */
  model?: string;
  /** "packshot" marks the legacy Blender hero shot. */
  source?: "packshot";
  /** Which Blender camera template to use; inferred from `camera` when absent. */
  template?: BlenderTemplateId;
  /** Treat as a text/graphic card (no filmed subject). */
  graphic?: boolean;
}

export interface RenderContext {
  mode: RenderMode;
  width: number;
  height: number;
  /** Reference product photos (data URLs); Blender needs one to unwrap the real label. */
  refs: string[];
  /** AI video: the approved keyframe. */
  firstFrame?: string;
  /** AI video: full prompt text, built by the caller. */
  prompt?: string;
  /** AI video: resolution tier ("480p"). */
  resolution?: string;
  /** Remotion card props, when the row is a card. */
  card?: { brand: string; line?: string; cta?: string; footer?: string; bg?: string; ink?: "black" | "white"; accent?: string };
  signal?: AbortSignal;
}

export interface RenderResult {
  /** data: URL or a URL the store can ingest (video/mp4 or image/png for stills). */
  url: string;
  costUsd: number;
  renderer: RendererId;
  /** Set when the router could not use its first choice. */
  fellBackFrom?: RendererId;
  note?: string;
  ms?: number;
}

export interface Renderer {
  id: RendererId;
  available(): Promise<boolean>;
  /** Estimated paid cost of one render in USD (0 for local renderers). */
  estimateUsd(row: ShotRow, ctx: RenderContext): number;
  render(row: ShotRow, ctx: RenderContext): Promise<{ url: string; costUsd: number; note?: string }>;
}

export class RendererUnavailable extends Error {
  constructor(public readonly renderer: RendererId, why: string) {
    super(`${renderer} renderer unavailable: ${why}`);
    this.name = "RendererUnavailable";
  }
}

/** Adapts today's `Shot` to a row. The explicit `model` prefix decides the renderer, so existing plans keep working. */
export function rowFromShot(s: Shot, extra: Partial<ShotRow> = {}): ShotRow {
  const lens = s.spec?.lensMm || Number(/(\d{2,3})\s?mm/i.exec(`${s.lens ?? ""} ${s.camera}`)?.[1]) || undefined;
  return {
    id: s.id, beat: s.beat, seconds: s.seconds, action: s.expectedVisual || s.visual, camera: s.spec?.cameraMove || s.camera,
    lensMm: lens, lighting: s.spec?.lighting, onScreen: s.onScreen, source: s.source, model: s.model, ...extra,
  };
}
