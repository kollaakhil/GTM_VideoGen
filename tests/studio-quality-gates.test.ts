import { describe, it, expect } from "vitest";
import { sheetGate } from "@/lib/sheet/gate";
import type { ShotSheet } from "@/lib/shot-sheet";

describe("Studio quality gate fixes", () => {
  const baseSheet: ShotSheet = {
    version: 1,
    targetSec: 20,
    aspect: "16:9",
    fps: 24,
    audioMode: "vo",
    bed: "",
    palette: "bright",
    rules: [],
    endCard: { title: "Brand", line: "Get it now", footer: "" },
    shots: [
      {
        id: "s1",
        n: 1,
        start: 0,
        end: 3,
        shotType: "CU",
        framing: "close up",
        camera: { angle: "eye level", move: "static", lensMm: 50 },
        subject: "product bottle",
        action: "gleams",
        lighting: "soft",
        text: null,
        audio: { vo: "Check this out", sfx: null, music: null },
        transition: "cut",
        engine: "blender",
        engineLocked: false,
        editorNote: "",
      },
      {
        id: "s2",
        n: 2,
        start: 3,
        end: 20,
        shotType: "MS",
        framing: "end card",
        camera: { angle: "eye level", move: "static", lensMm: 50 },
        subject: "end card",
        action: "",
        lighting: "",
        text: null,
        audio: { vo: null, sfx: null, music: null },
        transition: "cut",
        engine: "remotion",
        engineLocked: false,
        editorNote: "",
      },
    ],
    patternId: "confession_loop",
  };

  it("Error: product photos exist but no product shots", () => {
    const sheet = { ...baseSheet, shots: [
      { ...baseSheet.shots[0], subject: "person talking", engine: "ai_video" as const, prompt: "person talking to camera" },
      baseSheet.shots[1],
    ]};
    const gate = sheetGate(sheet, { facts: "- Premium product", rules: [], hasPhotos: true });
    
    const productError = gate.issues.find(i => i.text.includes("Product photos exist but there are no product shots"));
    expect(productError).toBeTruthy();
    expect(productError?.level).toBe("error");
  });

  it("Warning: no product photos when product shots exist", () => {
    const gate = sheetGate(baseSheet, { facts: "- Premium product", rules: [], hasPhotos: false });
    
    const photoWarning = gate.issues.find(i => i.text.includes("No product photos available"));
    expect(photoWarning).toBeTruthy();
    expect(photoWarning?.level).toBe("warn");
  });

  it("No warning: no product photos and no product shots", () => {
    const sheet = { ...baseSheet, shots: [
      { ...baseSheet.shots[0], subject: "abstract animation", engine: "blender" as const },
      baseSheet.shots[1],
    ]};
    const gate = sheetGate(sheet, { facts: "- Premium product", rules: [], hasPhotos: false });
    
    const photoWarning = gate.issues.find(i => i.text.includes("No product photos available"));
    expect(photoWarning).toBeUndefined();
  });

  it("Warning: people shots without character defined", () => {
    const sheet = { ...baseSheet, shots: [
      { ...baseSheet.shots[0], subject: "person talking", engine: "ai_video" as const, prompt: "person talking to camera" },
      baseSheet.shots[1],
    ]};
    const gate = sheetGate(sheet, { facts: "- Premium product", rules: [], hasPhotos: false });
    
    const characterWarning = gate.issues.find(i => i.text.includes("people shot") && i.text.includes("recurring character"));
    expect(characterWarning).toBeTruthy();
    expect(characterWarning?.level).toBe("warn");
  });

  it("Warning: people shot doesn't reference character", () => {
    const sheet: ShotSheet = {
      ...baseSheet,
      character: { description: "Mid-30s male, black hoodie, stubble, bright kitchen", referenceUrl: null },
      shots: [
        { ...baseSheet.shots[0], subject: "woman in office", engine: "ai_video" as const, prompt: "woman in business suit" },
        baseSheet.shots[1],
      ],
    };
    const gate = sheetGate(sheet, { facts: "- Premium product", rules: [], hasPhotos: false });
    
    const referenceWarning = gate.issues.find(i => i.text.includes("doesn't clearly reference the character"));
    expect(referenceWarning).toBeTruthy();
    expect(referenceWarning?.level).toBe("warn");
  });

  it("No warning: people shot references character", () => {
    const sheet: ShotSheet = {
      ...baseSheet,
      character: { description: "Mid-30s male, black hoodie, stubble, bright kitchen", referenceUrl: null },
      shots: [
        { ...baseSheet.shots[0], subject: "male in black hoodie", engine: "ai_video" as const, prompt: "mid-30s male with stubble in black hoodie, bright kitchen" },
        baseSheet.shots[1],
      ],
    };
    const gate = sheetGate(sheet, { facts: "- Premium product", rules: [], hasPhotos: false });
    
    const referenceWarning = gate.issues.find(i => i.text.includes("doesn't clearly reference the character"));
    expect(referenceWarning).toBeUndefined();
  });

  it("No warning: hasPhotos undefined (legacy behavior)", () => {
    const gate = sheetGate(baseSheet, { facts: "- Premium product", rules: [] });
    
    const photoWarning = gate.issues.find(i => i.text.includes("No product photos available"));
    expect(photoWarning).toBeUndefined();
  });
});
