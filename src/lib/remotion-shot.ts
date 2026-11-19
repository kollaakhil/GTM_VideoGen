import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { SheetShot, ShotSheet } from "./shot-sheet";

/**
 * Remotion renderer for shot sheet rows with engine `remotion`. Covers kinetic text cards, title overlays,
 * and the closing end card (logo, headline, CTA, fade from black). Caches by input hash so unchanged rows
 * are skipped. House style: black background, desaturated colors, restrained type, hard cuts, fade to black
 * before the end card. Text should feel like part of the scene (PLAYBOOK 14.4).
 */

export interface BrandContext {
  name: string;
  colors: { primary: string; accent: string };
  logo?: string;
}

export interface RemotionShotOpts {
  width: number;
  height: number;
  fps: number;
  cacheDir?: string;
}

export interface RemotionShotResult {
  path: string;
  durationSec: number;
  ms: number;
}

const DESATURATED_ACCENT = "#6b6b6b";
const BLACK_BG = "#0b0b0f";
const WHITE_INK = "#ffffff";

/**
 * Computes a cache key from the shot row, brand, and render options. Unchanged inputs produce the same key,
 * so re-renders are skipped.
 */
export function shotCacheKey(row: SheetShot, brand: BrandContext, opts: RemotionShotOpts): string {
  const input = JSON.stringify({
    id: row.id,
    text: row.text,
    engine: row.engine,
    start: row.start,
    end: row.end,
    transition: row.transition,
    brand: { name: brand.name, colors: brand.colors, logo: brand.logo },
    opts: { width: opts.width, height: opts.height, fps: opts.fps },
  });
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/**
 * Maps a shot sheet row to Remotion composition props. Determines which composition to use based on text placement
 * and whether it's an end card.
 */
function mapRowToProps(row: SheetShot, brand: BrandContext, sheet: ShotSheet, opts: RemotionShotOpts) {
  const isEndCard = row === sheet.shots[sheet.shots.length - 1] && row.engine === "remotion";
  const durationSec = row.end - row.start;
  
  if (isEndCard) {
    return {
      compositionId: "EndCard" as const,
      props: {
        width: opts.width,
        height: opts.height,
        seconds: durationSec,
        card: {
          brand: sheet.endCard.title,
          line: sheet.endCard.line || undefined,
          cta: undefined,
          footer: sheet.endCard.footer || undefined,
          bg: BLACK_BG,
          ink: "white" as const,
          logo: brand.logo ?? null,
          accent: brand.colors.accent || DESATURATED_ACCENT,
        },
      },
      durationSec,
    };
  }
  
  if (!row.text?.copy) {
    throw new Error(`Remotion shot ${row.id} has no text.copy`);
  }
  
  const placement = row.text.placement.toLowerCase();
  
  // Lower third for overlays
  if (placement.includes("lower") || placement.includes("third") || placement.includes("bottom")) {
    return {
      compositionId: "LowerThird" as const,
      props: {
        text: row.text.copy,
        placement: row.text.placement,
        bg: BLACK_BG,
        accent: brand.colors.accent || DESATURATED_ACCENT,
      },
      durationSec,
    };
  }
  
  // Text card for center, upper, or other placements
  const cardPlacement = placement.includes("upper") || placement.includes("top") 
    ? "upper" as const
    : placement.includes("center") || placement.includes("middle")
    ? "center" as const
    : "lower" as const;
  
  return {
    compositionId: "TextCard" as const,
    props: {
      text: row.text.copy,
      placement: cardPlacement,
      bg: BLACK_BG,
      ink: WHITE_INK,
      accent: brand.colors.accent || DESATURATED_ACCENT,
    },
    durationSec,
  };
}

/**
 * Renders a Remotion shot to MP4 at the requested resolution and fps. Caches by input hash so unchanged rows
 * are skipped. Returns the path to the rendered file, duration, and render time in ms.
 */
export async function renderRemotionShot(
  row: SheetShot,
  brand: BrandContext,
  sheet: ShotSheet,
  opts: RemotionShotOpts
): Promise<RemotionShotResult> {
  const t0 = Date.now();
  
  // Check cache
  const cacheKey = shotCacheKey(row, brand, opts);
  const cacheDir = opts.cacheDir ?? path.join(os.tmpdir(), "remotion-cache");
  await fs.mkdir(cacheDir, { recursive: true });
  const cachedPath = path.join(cacheDir, `${cacheKey}.mp4`);
  
  try {
    await fs.access(cachedPath);
    const durationSec = row.end - row.start;
    return { path: cachedPath, durationSec, ms: Date.now() - t0 };
  } catch {
    // Cache miss, continue to render
  }
  
  // Map row to composition
  const { compositionId, props, durationSec } = mapRowToProps(row, brand, sheet, opts);
  
  // Bundle and render
  const { bundle } = await import("@remotion/bundler");
  const { renderMedia, selectComposition } = await import("@remotion/renderer");
  
  const serveUrl = await bundle({ 
    entryPoint: path.join(process.cwd(), "remotion/index.ts"),
    publicDir: path.join(process.cwd(), "assets/fonts"),
  });
  
  const inputProps = {
    ...props,
    width: opts.width,
    height: opts.height,
    seconds: durationSec,
  } as Record<string, unknown>;
  
  const composition = await selectComposition({ 
    serveUrl, 
    id: compositionId, 
    inputProps,
  });
  
  // Render to temp first, then move to cache
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "remotion-shot-"));
  const tempPath = path.join(tempDir, "output.mp4");
  
  try {
    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      outputLocation: tempPath,
      codec: "h264",
      imageFormat: "jpeg",
      crf: 18,
      concurrency: 2,
      logLevel: "error",
    });
    
    // Move to cache
    await fs.rename(tempPath, cachedPath);
    
    return { path: cachedPath, durationSec, ms: Date.now() - t0 };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
