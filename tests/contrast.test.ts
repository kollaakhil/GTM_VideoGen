import { describe, it, expect } from "vitest";
import { contrastRatio, hasSufficientContrast, ensureContrast, clampBackgroundLuminance } from "../remotion/contrast";

describe("contrast utilities", () => {
  describe("contrastRatio", () => {
    it("calculates 21:1 for white on black", () => {
      expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 0);
    });

    it("calculates 1:1 for identical colors", () => {
      expect(contrastRatio("#808080", "#808080")).toBeCloseTo(1, 1);
    });

    it("calculates ~4.5:1 for medium gray on black", () => {
      // #767676 on #000000 is approximately 4.5:1
      const ratio = contrastRatio("#767676", "#000000");
      expect(ratio).toBeGreaterThanOrEqual(4.5);
      expect(ratio).toBeLessThan(5);
    });
  });

  describe("hasSufficientContrast", () => {
    it("returns true for white on black", () => {
      expect(hasSufficientContrast("#ffffff", "#000000")).toBe(true);
    });

    it("returns false for light gray on white", () => {
      expect(hasSufficientContrast("#cccccc", "#ffffff")).toBe(false);
    });

    it("returns true for dark text on light background", () => {
      expect(hasSufficientContrast("#333333", "#ffffff")).toBe(true);
    });

    it("returns false for near-black on black", () => {
      expect(hasSufficientContrast("#111111", "#000000")).toBe(false);
    });
  });

  describe("ensureContrast", () => {
    it("keeps good contrast unchanged", () => {
      const result = ensureContrast("#ffffff", "#000000");
      expect(result.color).toBe("#ffffff");
      expect(result.needsStroke).toBe(false);
    });

    it("switches to white for dark background when original is low contrast", () => {
      const result = ensureContrast("#333333", "#0b0b0f"); // dark gray on near-black
      expect(result.color).toBe("#ffffff");
      expect(result.needsStroke).toBe(true);
    });

    it("switches to near-black for light background when original is low contrast", () => {
      const result = ensureContrast("#cccccc", "#ffffff"); // light gray on white
      expect(result.color).toBe("#0f0f0f");
      expect(result.needsStroke).toBe(true);
    });
  });

  describe("clampBackgroundLuminance", () => {
    it("keeps light backgrounds unchanged", () => {
      const result = clampBackgroundLuminance("#ffffff");
      expect(result).toBe("#ffffff");
    });

    it("lightens very dark backgrounds", () => {
      const result = clampBackgroundLuminance("#000000");
      // Should be lighter than black but still dark
      expect(result).not.toBe("#000000");
      const r = parseInt(result.slice(1, 3), 16);
      expect(r).toBeGreaterThan(0);
      expect(r).toBeLessThan(100);
    });

    it("preserves medium-dark backgrounds above minimum", () => {
      const result = clampBackgroundLuminance("#404040");
      // #404040 has sufficient luminance (>0.05), should be unchanged
      expect(result).toBe("#404040");
    });

    it("respects custom minimum luminance", () => {
      const result1 = clampBackgroundLuminance("#000000", 0.05);
      const result2 = clampBackgroundLuminance("#000000", 0.25);
      // Higher minimum should produce lighter result
      const lum1 = parseInt(result1.slice(1, 3), 16);
      const lum2 = parseInt(result2.slice(1, 3), 16);
      expect(lum2).toBeGreaterThan(lum1);
    });
  });
});
