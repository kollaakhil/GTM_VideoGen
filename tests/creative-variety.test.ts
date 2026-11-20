import { describe, expect, it, afterEach } from "vitest";
import { generateConcepts, pickStrongestConcept, checkNovelty, recordConcept, resetNoveltyTracking, type Concept } from "@/lib/sheet/concepts";
import { sheetPrompt, normaliseSheet, type SheetInput } from "@/lib/sheet/writer";
import { sheetGate } from "@/lib/sheet/gate";
import { newSheetRun } from "@/lib/sheet/flow";

describe("Creative variety system", () => {
  afterEach(() => {
    // Reset novelty tracking to prevent state leakage between tests
    resetNoveltyTracking();
  });
  describe("Concept generation", () => {
    it("generates 3 distinct concepts", async () => {
      const mockChat = async <T,>(_system: string, _user: string): Promise<{ data: T; usd: number }> => ({
        data: {
          concepts: [
            {
              logline: "A founder discovers the secret to productivity",
              premise: "Problem: teams waste time in endless meetings. Solution: async-first workflow",
              structure: "Problem reveal -> Solution demo -> Results",
              setting: "Modern startup office, glass walls, natural light",
              character: "30s female founder, casual blazer, confident energy",
              visualWorld: "Clean, minimal, professional with warm tones",
              tone: "Confident and empowering",
              openingShot: "Wide shot of empty conference room with unmuted Zoom call",
              keyDevice: "Split-screen showing sync vs async work",
            },
            {
              logline: "The mundane task that changed everything",
              premise: "Small daily action compounds into massive results",
              structure: "Montage of tiny actions -> time-lapse growth",
              setting: "Home office, evolving from cluttered to organized",
              character: null,
              visualWorld: "Time-lapse, warm morning light, intimate and personal",
              tone: "Reflective and inspiring",
              openingShot: "Extreme close-up of hand writing first task in fresh notebook",
              keyDevice: "Time compression showing weeks in seconds",
            },
            {
              logline: "What if you stopped trying so hard?",
              premise: "Counterintuitive insight: less effort, better results",
              structure: "Question -> Demonstration -> Payoff",
              setting: "Abstract studio space with floating product",
              character: null,
              visualWorld: "Surreal, floating objects, soft gradients, dreamlike",
              tone: "Playful and curious",
              openingShot: "Product suspended in mid-air, rotating slowly",
              keyDevice: "Gravity-defying product showcase",
            },
          ],
        } as T,
        usd: 0.01,
      });

      const concepts = await generateConcepts(mockChat, {
        brand: "TaskFlow",
        goal: "Drive signups for async collaboration tool",
        brief: null,
        research: { audience: "Remote teams", tone: "Professional but friendly" } as any,
        targetSec: 15,
      });

      expect(concepts).toHaveLength(3);
      expect(concepts[0].logline).toContain("founder");
      expect(concepts[1].logline).toContain("mundane task");
      expect(concepts[2].logline.toLowerCase()).toContain("stop");

      // Each concept should have distinct settings
      const settings = concepts.map((c) => c.setting);
      expect(new Set(settings).size).toBe(3);
    });

    it("picks the strongest concept", () => {
      const concepts: Concept[] = [
        {
          id: "concept_1",
          logline: "A founder discovers the secret",
          premise: "Problem and solution",
          structure: "Linear",
          setting: "Office",
          character: "Founder",
          visualWorld: "Clean",
          tone: "Confident",
          openingShot: "Wide shot",
          keyDevice: "Split screen",
        },
      ];

      const chosen = pickStrongestConcept(concepts);
      expect(chosen).toBe("concept_1");
    });
  });

  describe("Novelty guard", () => {
    it("flags repeated devices", () => {
      const concept1: Concept = {
        id: "c1",
        logline: "First concept",
        premise: "Test",
        structure: "Linear",
        setting: "Kitchen",
        character: null,
        visualWorld: "Minimal",
        tone: "Bold",
        openingShot: "Close-up of product",
        keyDevice: "text on wall",
      };

      const concept2: Concept = {
        id: "c2",
        logline: "Second concept",
        premise: "Test 2",
        structure: "Loop",
        setting: "Kitchen",
        character: null,
        visualWorld: "text painted on the wall",
        tone: "Playful",
        openingShot: "Close-up of product",
        keyDevice: "text on wall",
      };

      // Record first concept
      recordConcept(concept1);

      // Check second concept
      const check = checkNovelty(concept2);

      expect(check.warnings.length).toBeGreaterThan(0);
      expect(check.warnings.some((w) => w.includes("text on wall"))).toBe(true);
      expect(check.warnings.some((w) => w.includes("Kitchen"))).toBe(true);
    });

    it("detects stock devices", () => {
      const concept: Concept = {
        id: "c1",
        logline: "Test",
        premise: "Test",
        structure: "Linear",
        setting: "Urban street",
        character: null,
        visualWorld: "Location title card appears",
        tone: "Bold",
        openingShot: "Text on the wall saying location",
        keyDevice: null,
      };

      const check = checkNovelty(concept);

      expect(check.warnings.length).toBeGreaterThan(0);
      expect(check.repeatedDevices.some((d) => d.includes("text on wall") || d.includes("location title card"))).toBe(true);
    });
  });

  describe("Pattern defaults", () => {
    it("defaults to auto pattern, not confession_loop", () => {
      const run = newSheetRun({
        brandUrl: "https://example.com",
        goal: "Drive signups",
      }, "test-user");

      expect(run.input.patternId).toBe("auto");
    });

    it("allows explicit confession_loop pattern", () => {
      const run = newSheetRun({
        brandUrl: "https://example.com",
        goal: "Drive signups",
        patternId: "confession_loop",
      }, "test-user");

      expect(run.input.patternId).toBe("confession_loop");
    });
  });

  describe("Sheet prompt with concept", () => {
    it("includes concept details in prompt", () => {
      const input: SheetInput = {
        brand: "TestBrand",
        goal: "Drive sales",
        facts: "Product costs $50",
        brief: null,
        research: null,
        rules: [],
        targetSec: 15,
        aspect: "9:16",
        audioMode: "foley",
        hasPhotos: false,
        patternId: "auto",
        concept: {
          logline: "The product that changed everything",
          premise: "Problem solved by product",
          structure: "Before/after",
          setting: "Modern kitchen",
          character: "30s woman, casual outfit",
          visualWorld: "Bright, clean, aspirational",
          tone: "Confident",
          openingShot: "Close-up of frustrated face",
        },
      };

      const prompt = sheetPrompt(input);

      expect(prompt).toContain("STORY CONCEPT");
      expect(prompt).toContain("The product that changed everything");
      expect(prompt).toContain("Before/after");
      expect(prompt).toContain("Modern kitchen");
      expect(prompt).toContain("Close-up of frustrated face");
    });

    it("works without concept for specific patterns", () => {
      const input: SheetInput = {
        brand: "TestBrand",
        goal: "Drive sales",
        facts: "Product costs $50",
        brief: null,
        research: null,
        rules: [],
        targetSec: 15,
        aspect: "9:16",
        audioMode: "foley",
        hasPhotos: false,
        patternId: "confession_loop",
        concept: null,
      };

      const prompt = sheetPrompt(input);

      expect(prompt).toContain("Confession loop");
      expect(prompt).not.toContain("STORY CONCEPT");
    });

    it("specifies free-form structure for auto pattern", () => {
      const input: SheetInput = {
        brand: "TestBrand",
        goal: "Drive sales",
        facts: "",
        brief: null,
        research: null,
        rules: [],
        targetSec: 15,
        aspect: "9:16",
        audioMode: "foley",
        hasPhotos: false,
        patternId: "auto",
      };

      const prompt = sheetPrompt(input);

      expect(prompt).toContain("Free-form");
      expect(prompt).toContain("NOT required to use confession_loop beats");
      expect(prompt).toContain("Text can be overlaid");
    });
  });

  describe("Gate checks", () => {
    it("does not require specific beats for auto pattern", () => {
      const sheet = normaliseSheet(
        {
          bed: "",
          palette: "blue and white",
          patternId: "auto",
          endCard: { title: "Brand", line: "", footer: "" },
          shots: [
            {
              start: 0,
              end: 2,
              shotType: "WS",
              framing: "Product in scene",
              camera: { angle: "eye level", move: "static", lensMm: 50 },
              subject: "Product on table",
              action: "Sits still",
              lighting: "Natural",
              text: null,
              audio: { vo: null, sfx: "table tap", music: null },
              transition: "cut",
              engine: "blender",
              blender: { template: "product_hero" },
            },
            {
              start: 2,
              end: 3.5,
              shotType: "end card",
              framing: "Full frame",
              camera: { angle: "eye level", move: "static", lensMm: 50 },
              subject: "End card",
              action: "Holds",
              lighting: "Flat",
              text: null,
              audio: { vo: null, sfx: null, music: null },
              transition: "fade_black",
              engine: "remotion",
            },
          ],
        },
        { targetSec: 15, aspect: "9:16", audioMode: "foley", rules: [], patternId: "auto" }
      );

      const gate = sheetGate(sheet, { facts: "", rules: [] });

      // Should not warn about missing beats since pattern is auto
      const beatWarnings = gate.issues.filter((i) => i.text.includes("Missing beats"));
      expect(beatWarnings).toHaveLength(0);
    });

    it("warns about missing beats only when pattern beats are used", () => {
      const sheet = normaliseSheet(
        {
          bed: "",
          palette: "blue and white",
          patternId: "confession_loop",
          endCard: { title: "Brand", line: "", footer: "" },
          shots: [
            {
              start: 0,
              end: 2,
              shotType: "CU",
              framing: "Face",
              camera: { angle: "eye level", move: "static", lensMm: 50 },
              subject: "Person",
              action: "Talks",
              lighting: "Natural",
              text: null,
              audio: { vo: "This is the goal", sfx: null, music: null },
              transition: "cut",
              engine: "ai_video",
              beat: "goal",
            },
            {
              start: 2,
              end: 3.5,
              shotType: "end card",
              framing: "Full frame",
              camera: { angle: "eye level", move: "static", lensMm: 50 },
              subject: "End card",
              action: "Holds",
              lighting: "Flat",
              text: null,
              audio: { vo: null, sfx: null, music: null },
              transition: "fade_black",
              engine: "remotion",
            },
          ],
        },
        { targetSec: 15, aspect: "9:16", audioMode: "vo", rules: [], patternId: "confession_loop" }
      );

      const gate = sheetGate(sheet, { facts: "", rules: [] });

      // Should warn about missing beats since confession_loop pattern is used
      const beatWarnings = gate.issues.filter((i) => i.text.includes("Missing beats"));
      expect(beatWarnings.length).toBeGreaterThan(0);
    });

    it("does not enforce diegetic text rule", () => {
      const sheet = normaliseSheet(
        {
          bed: "",
          palette: "blue and white",
          patternId: "auto",
          endCard: { title: "Brand", line: "", footer: "" },
          shots: [
            {
              start: 0,
              end: 2,
              shotType: "WS",
              framing: "Scene",
              camera: { angle: "eye level", move: "static", lensMm: 50 },
              subject: "Product",
              action: "Appears",
              lighting: "Bright",
              text: { copy: "NEW", placement: "lower third", chunks: ["NEW"] },
              audio: { vo: null, sfx: "whoosh", music: null },
              transition: "cut",
              engine: "blender",
              blender: { template: "product_hero" },
            },
            {
              start: 2,
              end: 3.5,
              shotType: "end card",
              framing: "Full",
              camera: { angle: "eye level", move: "static", lensMm: 50 },
              subject: "End card",
              action: "Holds",
              lighting: "Flat",
              text: null,
              audio: { vo: null, sfx: null, music: null },
              transition: "fade_black",
              engine: "remotion",
            },
          ],
        },
        { targetSec: 15, aspect: "9:16", audioMode: "foley", rules: [{ id: "r14", text: "Text is diegetic until the end card", check: "diegetic_text" }], patternId: "auto" }
      );

      const gate = sheetGate(sheet, { facts: "", rules: [{ id: "r14", text: "Text is diegetic until the end card", check: "diegetic_text" }] });

      // Should not have diegetic text warnings (rule removed)
      const diegeticWarnings = gate.issues.filter((i) => i.text.includes("text belongs in the scene"));
      expect(diegeticWarnings).toHaveLength(0);
    });
  });
});
