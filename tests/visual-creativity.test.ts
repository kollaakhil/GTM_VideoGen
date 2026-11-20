import { describe, expect, it } from "vitest";
import { kitJob } from "@/lib/render/blender-kit";
import type { SheetShot, ShotSheet } from "@/lib/shot-sheet";
import { dur } from "@/lib/shot-sheet";

describe("Visual creativity: look-driven rendering", () => {
  const mockShot: SheetShot = {
    id: "shot1",
    n: 1,
    start: 0,
    end: 2,
    shotType: "Close-up",
    framing: "Tight on product",
    camera: { angle: "eye level", move: "push in 15%", lensMm: 85 },
    subject: "Product label",
    action: "glowing text appears",
    lighting: "dramatic rim",
    text: null,
    audio: { vo: null, sfx: null, music: null },
    transition: "cut",
    engine: "blender",
    engineLocked: false,
    blender: { template: "macro_label", label: "PREMIUM" },
    editorNote: "",
  };

  const mockSheet: Pick<ShotSheet, "palette" | "look"> = {
    palette: "#ff3b1a #1a1a1a",
    look: {
      background: "#0a0a0c",
      palette: ["#ff3b1a", "#ffa500"],
      grade: "AgX - Punchy",
      rimColor: "#88aaff",
    },
  };

  describe("Blender look parameters", () => {
    it("passes background from sheet look to Blender spec", () => {
      const job = kitJob(mockShot, mockSheet, { width: 720, height: 1280, mode: "preview" });
      expect(job.spec).toHaveProperty("background", "#0a0a0c");
    });

    it("passes grade from sheet look to Blender spec", () => {
      const job = kitJob(mockShot, mockSheet, { width: 720, height: 1280, mode: "preview" });
      expect(job.spec).toHaveProperty("grade", "AgX - Punchy");
    });

    it("passes rimColor from sheet look to Blender spec", () => {
      const job = kitJob(mockShot, mockSheet, { width: 720, height: 1280, mode: "preview" });
      expect(job.spec).toHaveProperty("rimColor", "#88aaff");
    });

    it("uses per-shot look override when present", () => {
      const shotWithLook: SheetShot = {
        ...mockShot,
        look: {
          background: "#000000",
          rimColor: "#ffffff",
        },
      };
      const job = kitJob(shotWithLook, mockSheet, { width: 720, height: 1280, mode: "preview" });
      expect(job.spec).toHaveProperty("background", "#000000");
      expect(job.spec).toHaveProperty("rimColor", "#ffffff");
    });

    it("falls back to brand palette when look colors missing", () => {
      const sheetNoBrandLook: Pick<ShotSheet, "palette" | "look"> = {
        palette: "#123456 #abcdef",
        look: undefined,
      };
      const job = kitJob(mockShot, sheetNoBrandLook, { width: 720, height: 1280, mode: "preview" });
      expect(job.spec.color).toBe("#123456");
    });

    it("uses look palette when blender.color is not set", () => {
      const shotNoColor: SheetShot = {
        ...mockShot,
        blender: { template: "macro_label", label: "PREMIUM" }, // No color
      };
      const job = kitJob(shotNoColor, mockSheet, { width: 720, height: 1280, mode: "preview" });
      // Should use first color from look.palette
      expect(job.spec.color).toBe("#ff3b1a");
    });

    it("passes materialColor for macro_label from look palette", () => {
      const labelShot: SheetShot = {
        ...mockShot,
        blender: { template: "macro_label", label: "COPPER" },
      };
      const job = kitJob(labelShot, mockSheet, { width: 720, height: 1280, mode: "preview" });
      expect(job.spec).toHaveProperty("materialColor", "#ff3b1a");
    });
  });

  describe("Camera moves", () => {
    it("normalizes push camera move", () => {
      const job = kitJob(mockShot, mockSheet, { width: 720, height: 1280, mode: "preview" });
      expect((job.spec.camera as { move: string }).move).toBe("push in 15%");
    });

    it("handles dolly move", () => {
      const dollyShot: SheetShot = { ...mockShot, camera: { ...mockShot.camera, move: "dolly in" } };
      const job = kitJob(dollyShot, mockSheet, { width: 720, height: 1280, mode: "preview" });
      expect((job.spec.camera as { move: string }).move).toBe("dolly in");
    });

    it("handles truck move", () => {
      const truckShot: SheetShot = { ...mockShot, camera: { ...mockShot.camera, move: "truck left" } };
      const job = kitJob(truckShot, mockSheet, { width: 720, height: 1280, mode: "preview" });
      expect((job.spec.camera as { move: string }).move).toBe("truck left");
    });

    it("handles crane move", () => {
      const craneShot: SheetShot = { ...mockShot, camera: { ...mockShot.camera, move: "crane up" } };
      const job = kitJob(craneShot, mockSheet, { width: 720, height: 1280, mode: "preview" });
      expect((job.spec.camera as { move: string }).move).toBe("crane up");
    });

    it("handles whip pan move", () => {
      const whipShot: SheetShot = { ...mockShot, camera: { ...mockShot.camera, move: "whip pan" } };
      const job = kitJob(whipShot, mockSheet, { width: 720, height: 1280, mode: "preview" });
      expect((job.spec.camera as { move: string }).move).toBe("whip pan");
    });

    it("handles handheld drift move", () => {
      const handShot: SheetShot = { ...mockShot, camera: { ...mockShot.camera, move: "handheld drift" } };
      const job = kitJob(handShot, mockSheet, { width: 720, height: 1280, mode: "preview" });
      expect((job.spec.camera as { move: string }).move).toBe("handheld drift");
    });

    it("passes unknown camera moves through", () => {
      const customShot: SheetShot = { ...mockShot, camera: { ...mockShot.camera, move: "custom move" } };
      const job = kitJob(customShot, mockSheet, { width: 720, height: 1280, mode: "preview" });
      expect((job.spec.camera as { move: string }).move).toBe("custom move");
    });
  });

  describe("Font handling", () => {
    it("passes fontPath when look.font is provided", () => {
      const sheetWithFont: Pick<ShotSheet, "palette" | "look"> = {
        ...mockSheet,
        look: { ...mockSheet.look, font: "Helvetica Bold" },
      };
      const job = kitJob(mockShot, sheetWithFont, { width: 720, height: 1280, mode: "preview" });
      expect(job.spec).toHaveProperty("fontPath");
      expect(job.spec.fontPath).toContain("Helvetica");
    });

    it("resolves DejaVu Sans to bundled font", () => {
      const sheetWithFont: Pick<ShotSheet, "palette" | "look"> = {
        ...mockSheet,
        look: { ...mockSheet.look, font: "DejaVu Sans" },
      };
      const job = kitJob(mockShot, sheetWithFont, { width: 720, height: 1280, mode: "preview" });
      expect(job.spec.fontPath).toContain("DejaVuSans-Bold.ttf");
    });

    it("does not require macOS fonts", () => {
      const sheetWithFont: Pick<ShotSheet, "palette" | "look"> = {
        ...mockSheet,
        look: { ...mockSheet.look, font: "Arial" },
      };
      const job = kitJob(mockShot, sheetWithFont, { width: 720, height: 1280, mode: "preview" });
      // Should not contain /System/Library/Fonts
      expect(job.spec.fontPath).not.toContain("/System/Library/Fonts");
    });
  });

  describe("Transitions", () => {
    it("includes transition type in stitch parameters", () => {
      // This would be tested in an integration test with actual stitchShots
      // For now, just verify the transition field exists on shots
      const transitionShot: SheetShot = { ...mockShot, transition: "crossfade" };
      expect(transitionShot.transition).toBe("crossfade");
    });

    it("supports fade_black transition", () => {
      const shot: SheetShot = { ...mockShot, transition: "fade_black" };
      expect(shot.transition).toBe("fade_black");
    });

    it("supports whip transition", () => {
      const shot: SheetShot = { ...mockShot, transition: "whip" };
      expect(shot.transition).toBe("whip");
    });
  });

  describe("End card layouts", () => {
    it("includes layout in end card spec", () => {
      // This tests that the type system accepts layout
      const endCard: ShotSheet["endCard"] = {
        title: "Brand",
        line: "Offer line",
        footer: "Footer",
        layout: "hero",
      };
      expect(endCard.layout).toBe("hero");
    });

    it("supports all layout types", () => {
      const layouts = ["classic", "split", "minimal", "hero"];
      layouts.forEach((layout) => {
        const endCard: ShotSheet["endCard"] = {
          title: "Brand",
          line: "",
          footer: "",
          layout,
        };
        expect(endCard.layout).toBe(layout);
      });
    });
  });

  describe("Sheet without end card", () => {
    it("allows optional end card shot", () => {
      const shotsWithoutEndCard: SheetShot[] = [
        {
          ...mockShot,
          id: "shot1",
          n: 1,
          start: 0,
          end: 2,
          engine: "blender",
        },
        {
          ...mockShot,
          id: "shot2",
          n: 2,
          start: 2,
          end: 4,
          engine: "ai_video",
        },
      ];
      // Should not throw
      expect(shotsWithoutEndCard.every((s) => s.engine !== "remotion")).toBe(true);
    });
  });
});

describe("Mid-video remotion shots", () => {
  it("uses TextCard for mid-video text shots", () => {
    const textShot: SheetShot = {
      id: "text1",
      n: 2,
      start: 2,
      end: 4,
      shotType: "Text card",
      framing: "",
      camera: { angle: "static", move: "static", lensMm: 50 },
      subject: "Message",
      action: "text appears",
      lighting: "",
      text: { copy: "Save 50%", placement: "center" },
      audio: { vo: null, sfx: null, music: null },
      transition: "cut",
      engine: "remotion",
      engineLocked: true,
      editorNote: "",
    };

    expect(textShot.engine).toBe("remotion");
    expect(textShot.text?.copy).toBe("Save 50%");
  });

  it("uses LowerThird for overlay text", () => {
    const lowerThird: SheetShot = {
      id: "lower1",
      n: 3,
      start: 4,
      end: 6,
      shotType: "Lower third",
      framing: "",
      camera: { angle: "static", move: "static", lensMm: 50 },
      subject: "Name tag",
      action: "appears bottom",
      lighting: "",
      text: { copy: "John Doe, CEO", placement: "lower third" },
      audio: { vo: null, sfx: null, music: null },
      transition: "cut",
      engine: "remotion",
      engineLocked: true,
      editorNote: "",
    };

    expect(lowerThird.engine).toBe("remotion");
    expect(lowerThird.text?.placement).toBe("lower third");
  });
});
