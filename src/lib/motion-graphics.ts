import fs from "node:fs/promises";
import path from "node:path";
import type { CardProps, OverlayLine, OverlayProps } from "../../remotion/props";

/**
 * Motion graphics rendered with Remotion (React → frames in headless Chrome, all local): animated captions, offer
 * and price tags, callouts, and an animated end card. The overlay is rendered with alpha (ProRes 4444) and
 * composited over the AI shots by FFmpeg; the end card is an opaque clip. Layout is the same as the ASS path (same
 * slots and end-card heights), so OCR QA reads it the same way. Any failure falls back to the ASS typesetter.
 *
 * Licence: Remotion is free for individuals and companies of up to 3 people; larger companies need a Remotion
 * company licence (remotion.dev/license). See PLAYBOOK 13.12.
 */
const OFFER = /(\d+\s?%|\$\s?\d|\boff\b|\bfree\b|\bsale\b|\bends?\b|\bsave\b|\bdeal\b|\bprice\b|\bper can\b)/i;
export const overlayKind = (text: string): OverlayLine["kind"] => (OFFER.test(text) ? "tag" : "callout");

let bundled: Promise<string> | null = null;
function bundleOnce() {
  if (!bundled) {
    bundled = (async () => {
      const { bundle } = await import("@remotion/bundler");
      return bundle({ entryPoint: path.join(process.cwd(), "remotion/index.ts"), publicDir: path.join(process.cwd(), "assets/fonts") });
    })().catch((e) => {
      bundled = null;
      throw e;
    });
  }
  return bundled;
}

/** On by default; off under vitest unless MOTION_GRAPHICS=1 (unit tests must stay fast and offline). */
export const motionGraphicsEnabled = () => (process.env.MOTION_GRAPHICS ? process.env.MOTION_GRAPHICS !== "0" : !process.env.VITEST);

async function render(id: "Overlay" | "EndCard", props: OverlayProps | CardProps, out: string, alpha: boolean) {
  const { renderMedia, selectComposition } = await import("@remotion/renderer");
  const serveUrl = await bundleOnce();
  const inputProps = props as unknown as Record<string, unknown>;
  const composition = await selectComposition({ serveUrl, id, inputProps });
  await renderMedia({
    composition, serveUrl, inputProps, outputLocation: out, concurrency: 2, logLevel: "error",
    ...(alpha ? { codec: "prores" as const, proResProfile: "4444" as const, imageFormat: "png" as const, pixelFormat: "yuva444p10le" as const } : { codec: "h264" as const, imageFormat: "jpeg" as const, crf: 18 }),
  });
  await fs.access(out);
  return out;
}

export const renderOverlay = (p: OverlayProps, out: string) => render("Overlay", p, out, true);
export const renderEndCard = (p: CardProps, out: string) => render("EndCard", p, out, false);
