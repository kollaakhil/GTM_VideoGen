import { RendererUnavailable, type RenderContext, type Renderer, type RendererId, type RenderResult, type ShotRow } from "./types";

/** Words that mean a person, a hand or a live action is in shot: Blender can't fake those, AI video can. */
const LIVE = /\b(person|people|man|woman|girl|boy|friend|hand|hands|finger|fingers|face|smil\w*|laugh\w*|walk\w*|run\w*|hold\w*|grab\w*|pour\w*|drink\w*|sip\w*|crack\w*|open\w*|pop\w*|tilt\w*|dance\w*|crowd|kitchen|street|office|model)\b/i;
/** Wording of a camera-only product showcase. */
const SHOWCASE = /\b(hero|packshot|product shot|orbit|push-?in|macro|close-?up|rack focus|turntable|glow\w*|neon)\b/i;

export interface Routing { renderer: RendererId; reason: string }

/**
 * Decides which renderer a shot goes to. Order: operator choice, model prefix, legacy packshot, graphic card, then the
 * playbook rule (product shots to Blender, live action to AI video). Blender is only chosen automatically when a
 * product photo exists to unwrap the real label from.
 */
export function routeShot(row: ShotRow, o: { hasProductRef: boolean; autoBlender?: boolean }): Routing {
  if (row.renderer && row.renderer !== "auto") return { renderer: row.renderer, reason: "chosen on the shot sheet" };
  const m = row.model ?? "";
  if (m.startsWith("blender:")) return { renderer: "blender", reason: `model ${m}` };
  if (m.startsWith("remotion:")) return { renderer: "remotion", reason: `model ${m}` };
  if (row.source === "packshot") return { renderer: "blender", reason: "legacy packshot shot" };
  if (row.graphic) return { renderer: "remotion", reason: "text or graphic card, no filmed subject" };
  const text = `${row.action} ${row.camera}`;
  if (o.autoBlender && o.hasProductRef && !LIVE.test(text) && SHOWCASE.test(text)) {
    return { renderer: "blender", reason: "camera-only product shot: Blender keeps the real label (PLAYBOOK 13.24)" };
  }
  return { renderer: "ai-video", reason: LIVE.test(text) ? "people or live action" : "default" };
}

/** Where to go when a renderer cannot run. Remotion has none: its caller falls back to the ASS typesetter. */
export const FALLBACKS: Record<RendererId, RendererId[]> = { blender: ["ai-video"], "ai-video": [], remotion: [] };

export type RendererSet = Partial<Record<RendererId, Renderer>>;

/**
 * Renders one shot through the routed renderer. If it is unavailable (Blender missing, no keyframe for the fallback…)
 * the fallback chain is tried and the result says so. Render errors other than "unavailable" are NOT silently
 * rerouted, because that could spend money the operator did not choose; the scheduler handles retries.
 */
export async function renderRouted(row: ShotRow, ctx: RenderContext, renderers: RendererSet, opts: { autoBlender?: boolean } = {}): Promise<RenderResult & { routing: Routing }> {
  const routing = routeShot(row, { hasProductRef: ctx.refs.length > 0, autoBlender: opts.autoBlender });
  const chain = [routing.renderer, ...FALLBACKS[routing.renderer]];
  const why: string[] = [];
  for (const id of chain) {
    const r = renderers[id];
    if (!r) { why.push(`${id}: not configured`); continue; }
    if (!(await r.available())) { why.push(`${id}: not available`); continue; }
    if (id === "ai-video" && id !== routing.renderer && !ctx.firstFrame && !ctx.prompt) { why.push("ai-video: no keyframe or prompt to fall back with"); continue; }
    const t0 = Date.now();
    try {
      const out = await r.render(row, ctx);
      return { ...out, renderer: id, fellBackFrom: id === routing.renderer ? undefined : routing.renderer, ms: Date.now() - t0, routing };
    } catch (e) {
      if (e instanceof RendererUnavailable) { why.push(e.message); continue; }
      throw e;
    }
  }
  throw new RendererUnavailable(routing.renderer, why.join("; "));
}
