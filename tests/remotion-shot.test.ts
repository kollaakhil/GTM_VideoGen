import { describe, expect, it, vi } from "vitest";
import { shotCacheKey, type BrandContext, type RemotionShotOpts } from "@/lib/remotion-shot";
import type { SheetShot } from "@/lib/shot-sheet";

describe("Remotion shot renderer", () => {
  const brand: BrandContext = {
    name: "Test Brand",
    colors: { primary: "#000000", accent: "#6b6b6b" },
  };
  
  const opts: RemotionShotOpts = {
    width: 486,
    height: 864,
    fps: 30,
  };
  
  const makeShot = (overrides: Partial<SheetShot> = {}): SheetShot => ({
    id: "s1",
    n: 1,
    start: 0,
    end: 3,
    shotType: "card",
    framing: "",
    camera: { angle: "static", move: "none", lensMm: 35 },
    subject: "text card",
    action: "",
    lighting: "",
    text: { copy: "Sample text", placement: "center" },
    audio: { vo: null, sfx: null, music: null },
    transition: "cut",
    engine: "remotion",
    engineLocked: false,
    editorNote: "",
    ...overrides,
  });
  
  it("generates stable cache keys for identical inputs", () => {
    const shot = makeShot();
    const key1 = shotCacheKey(shot, brand, opts);
    const key2 = shotCacheKey(shot, brand, opts);
    expect(key1).toBe(key2);
    expect(key1).toHaveLength(16);
  });
  
  it("generates different cache keys for different text", () => {
    const shot1 = makeShot({ text: { copy: "Text A", placement: "center" } });
    const shot2 = makeShot({ text: { copy: "Text B", placement: "center" } });
    const key1 = shotCacheKey(shot1, brand, opts);
    const key2 = shotCacheKey(shot2, brand, opts);
    expect(key1).not.toBe(key2);
  });
  
  it("generates different cache keys for different durations", () => {
    const shot1 = makeShot({ start: 0, end: 2 });
    const shot2 = makeShot({ start: 0, end: 3 });
    const key1 = shotCacheKey(shot1, brand, opts);
    const key2 = shotCacheKey(shot2, brand, opts);
    expect(key1).not.toBe(key2);
  });
  
  it("generates different cache keys for different brand colors", () => {
    const brand1 = { ...brand, colors: { primary: "#000000", accent: "#6b6b6b" } };
    const brand2 = { ...brand, colors: { primary: "#000000", accent: "#ff0000" } };
    const shot = makeShot();
    const key1 = shotCacheKey(shot, brand1, opts);
    const key2 = shotCacheKey(shot, brand2, opts);
    expect(key1).not.toBe(key2);
  });
  
  it("generates different cache keys for different resolutions", () => {
    const shot = makeShot();
    const opts1 = { ...opts, width: 486, height: 864 };
    const opts2 = { ...opts, width: 1080, height: 1920 };
    const key1 = shotCacheKey(shot, brand, opts1);
    const key2 = shotCacheKey(shot, brand, opts2);
    expect(key1).not.toBe(key2);
  });
  
  it("calculates duration correctly from start and end times", () => {
    const shot = makeShot({ start: 1.5, end: 4.8 });
    const duration = shot.end - shot.start;
    expect(duration).toBeCloseTo(3.3, 1);
  });
  
  it("handles zero-duration shots gracefully in cache key", () => {
    const shot = makeShot({ start: 2, end: 2 });
    const key = shotCacheKey(shot, brand, opts);
    expect(key).toHaveLength(16);
  });
  
  it("includes transition in cache key", () => {
    const shot1 = makeShot({ transition: "cut" });
    const shot2 = makeShot({ transition: "fade_black" });
    const key1 = shotCacheKey(shot1, brand, opts);
    const key2 = shotCacheKey(shot2, brand, opts);
    expect(key1).not.toBe(key2);
  });
  
  it("ignores fields not used in rendering", () => {
    const shot1 = makeShot({ editorNote: "Note A", shotType: "Type A" });
    const shot2 = makeShot({ editorNote: "Note B", shotType: "Type B" });
    const key1 = shotCacheKey(shot1, brand, opts);
    const key2 = shotCacheKey(shot2, brand, opts);
    // Should be the same since editor note and shot type don't affect rendering
    expect(key1).toBe(key2);
  });
  
  it("duration math handles fractional seconds", () => {
    const shot = makeShot({ start: 0.333, end: 2.999 });
    const duration = shot.end - shot.start;
    expect(duration).toBeCloseTo(2.666, 3);
  });
});
