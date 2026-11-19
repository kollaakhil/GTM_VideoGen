#!/usr/bin/env tsx
/**
 * Smoke test for Remotion shot renderer. Renders a 3-second end card to verify the pipeline works.
 * 
 * Usage:
 *   npx tsx scripts/remotion-smoke.ts
 * 
 * Output:
 *   Renders a test end card to /tmp/remotion-smoke-test.mp4
 */

import { renderRemotionShot, type BrandContext } from "../src/lib/remotion-shot";
import type { SheetShot, ShotSheet } from "../src/lib/shot-sheet";

const brand: BrandContext = {
  name: "GTM Engine",
  colors: {
    primary: "#0b0b0f",
    accent: "#6b6b6b",
  },
};

const endCardShot: SheetShot = {
  id: "end-card-test",
  n: 1,
  start: 0,
  end: 3,
  shotType: "end card",
  framing: "",
  camera: { angle: "static", move: "none", lensMm: 35 },
  subject: "end card",
  action: "",
  lighting: "",
  text: null,
  audio: { vo: null, sfx: null, music: null },
  transition: "fade_black",
  engine: "remotion",
  engineLocked: true,
  editorNote: "",
};

const sheet: ShotSheet = {
  version: 1,
  targetSec: 30,
  aspect: "9:16",
  fps: 30,
  audioMode: "vo",
  bed: "",
  palette: "",
  rules: [],
  shots: [endCardShot],
  endCard: {
    title: "GTM Engine",
    line: "Build product ads in minutes",
    footer: "Start creating today",
  },
};

async function main() {
  console.log("Starting Remotion smoke test...");
  console.log("Rendering 3-second end card at 486×864 @ 30fps");
  
  const t0 = Date.now();
  
  try {
    const result = await renderRemotionShot(endCardShot, brand, sheet, {
      width: 486,
      height: 864,
      fps: 30,
      cacheDir: "/tmp",
    });
    
    const elapsed = Date.now() - t0;
    
    console.log("\n✓ Render complete!");
    console.log(`  Path: ${result.path}`);
    console.log(`  Duration: ${result.durationSec.toFixed(2)}s`);
    console.log(`  Render time: ${(result.ms / 1000).toFixed(1)}s`);
    console.log(`  Total time: ${(elapsed / 1000).toFixed(1)}s`);
    console.log("\nTo view:");
    console.log(`  open ${result.path}`);
    console.log(`  or: ffplay ${result.path}`);
    
    // Test cache hit
    console.log("\nTesting cache...");
    const t1 = Date.now();
    const cached = await renderRemotionShot(endCardShot, brand, sheet, {
      width: 486,
      height: 864,
      fps: 30,
      cacheDir: "/tmp",
    });
    const cacheTime = Date.now() - t1;
    
    console.log(`✓ Cache hit: ${cacheTime}ms (vs ${result.ms}ms for original render)`);
    
  } catch (error) {
    console.error("\n✗ Render failed:");
    console.error(error);
    process.exit(1);
  }
}

main();
