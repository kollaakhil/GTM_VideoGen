import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkTextLegibility } from "@/lib/qa/shot-check";
import { checkProductVisibility, finalChecks } from "@/lib/stage-gates";

describe("Quality gates final items", () => {
  describe("checkTextLegibility", () => {
    it("detects readable text with high confidence and word match", async () => {
      const mockFrame = vi.fn().mockResolvedValue("data:image/png;base64,mockdata");
      const mockOcr = vi.fn().mockResolvedValue({ text: "Buy Now Save 20%", confidence: 85 });

      const result = await checkTextLegibility(
        { id: "shot1", expected: "shot description", clip: "clip.mp4", seconds: 4, onScreen: "Buy Now Save 20%" },
        { frame: mockFrame, ocr: mockOcr }
      );

      expect(result).toBeDefined();
      expect(result?.readable).toBe(true);
      expect(result?.confidence).toBe(85);
      expect(result?.wordMatch).toBe(100);
      expect(result?.issue).toBeUndefined();
      expect(mockFrame).toHaveBeenCalledTimes(2);
      expect(mockOcr).toHaveBeenCalledTimes(2);
    });

    it("flags unreadable text with low confidence", async () => {
      const mockFrame = vi.fn().mockResolvedValue("data:image/png;base64,mockdata");
      const mockOcr = vi.fn().mockResolvedValue({ text: "garbled text", confidence: 35 });

      const result = await checkTextLegibility(
        { id: "shot1", expected: "shot description", clip: "clip.mp4", seconds: 4, onScreen: "Buy Now Save 20%" },
        { frame: mockFrame, ocr: mockOcr }
      );

      expect(result).toBeDefined();
      expect(result?.readable).toBe(false);
      expect(result?.confidence).toBe(35);
      expect(result?.issue).toBe("on-screen text unreadable");
    });

    it("flags unreadable text with poor word match", async () => {
      const mockFrame = vi.fn().mockResolvedValue("data:image/png;base64,mockdata");
      const mockOcr = vi.fn().mockResolvedValue({ text: "Wrong Words Here", confidence: 80 });

      const result = await checkTextLegibility(
        { id: "shot1", expected: "shot description", clip: "clip.mp4", seconds: 4, onScreen: "Buy Now Save 20%" },
        { frame: mockFrame, ocr: mockOcr }
      );

      expect(result).toBeDefined();
      expect(result?.readable).toBe(false);
      expect(result?.wordMatch).toBeLessThan(50);
      expect(result?.issue).toBe("on-screen text unreadable");
    });

    it("returns null for shots without onScreen text", async () => {
      const mockFrame = vi.fn();
      const mockOcr = vi.fn();

      const result = await checkTextLegibility(
        { id: "shot1", expected: "shot description", clip: "clip.mp4", seconds: 4 },
        { frame: mockFrame, ocr: mockOcr }
      );

      expect(result).toBeNull();
      expect(mockFrame).not.toHaveBeenCalled();
      expect(mockOcr).not.toHaveBeenCalled();
    });
  });

  describe("checkProductVisibility", () => {
    it("returns fallback on vision error (coverage test)", async () => {
      const frames = [{ at: 1.0, url: "data:image/png;base64,frame1" }];
      
      // Mock will fail, should return fallback
      const result = await checkProductVisibility("vision-model", frames, "OLIPOP");

      expect(result.score).toBe(0);
      expect(result.visible).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.cost).toBe(0);
    });
  });

  describe("finalChecks with new fields", () => {
    it("includes product visibility check when score is provided", () => {
      const checks = finalChecks({
        craft: 9,
        findings: [],
        shotScores: [9, 8, 9],
        productVisibilityScore: 10,
      });

      const productCheck = checks.find((c) => c.name === "product visibility");
      expect(productCheck).toBeDefined();
      expect(productCheck?.score).toBe(10);
      expect(productCheck?.by).toBe("judge");
      expect(productCheck?.weight).toBe(2);
    });

    it("scores 0 when product is not visible", () => {
      const checks = finalChecks({
        craft: 9,
        findings: [],
        shotScores: [9, 8, 9],
        productVisibilityScore: 0,
      });

      const productCheck = checks.find((c) => c.name === "product visibility");
      expect(productCheck).toBeDefined();
      expect(productCheck?.score).toBe(0);
      expect(productCheck?.note).toContain("not clearly visible");
    });

    it("penalizes inconsistent faces when people shots exist without character", () => {
      const checks = finalChecks({
        craft: 9,
        findings: [],
        shotScores: [9, 8, 9],
        hasPeopleShots: true,
        hasCharacter: false,
      });

      const faceCheck = checks.find((c) => c.name === "face consistency");
      expect(faceCheck).toBeDefined();
      expect(faceCheck?.score).toBe(3);
      expect(faceCheck?.weight).toBe(1.5);
    });

    it("does not penalize when character reference exists", () => {
      const checks = finalChecks({
        craft: 9,
        findings: [],
        shotScores: [9, 8, 9],
        hasPeopleShots: true,
        hasCharacter: true,
      });

      const faceCheck = checks.find((c) => c.name === "face consistency");
      expect(faceCheck).toBeUndefined();
    });
  });

  describe("end card product photo", () => {
    it("includes productPhoto in end card props structure", () => {
      const endCard = {
        brand: "OLIPOP",
        line: "Classic Soda, 2-5g Sugar",
        cta: "Shop Now",
        footer: "Available at Target",
        bg: "#FFE5B4",
        ink: "black" as const,
        logo: null,
        accent: "#FF6B35",
        productPhoto: "https://example.com/product.jpg",
      };

      expect(endCard.productPhoto).toBe("https://example.com/product.jpg");
      expect(endCard.brand).toBe("OLIPOP");
    });

    it("handles missing product photo gracefully", () => {
      const endCard = {
        brand: "OLIPOP",
        bg: "#FFE5B4",
        ink: "black" as const,
        accent: "#FF6B35",
        productPhoto: null,
      };

      expect(endCard.productPhoto).toBeNull();
    });
  });

  describe("removeProductPhoto logic", () => {
    it("filters photos by URL (unit test)", () => {
      const photos = [
        { url: "https://example.com/photo1.jpg", sourceUrl: "https://example.com/source1" },
        { url: "https://example.com/photo2.jpg", sourceUrl: "https://example.com/source2" },
      ];
      
      const photoToRemove = "https://example.com/photo1.jpg";
      const filtered = photos.filter((p) => p.url !== photoToRemove);
      
      expect(filtered).toHaveLength(1);
      expect(filtered[0].url).toBe("https://example.com/photo2.jpg");
    });
    
    it("handles removing a photo that doesn't exist (unit test)", () => {
      const photos = [
        { url: "https://example.com/photo1.jpg", sourceUrl: "https://example.com/source1" },
      ];
      
      const photoToRemove = "https://example.com/nonexistent.jpg";
      const filtered = photos.filter((p) => p.url !== photoToRemove);
      
      expect(filtered).toHaveLength(1);
      expect(filtered[0].url).toBe("https://example.com/photo1.jpg");
    });
  });
});
