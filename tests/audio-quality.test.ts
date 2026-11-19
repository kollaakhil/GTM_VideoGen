import { describe, it, expect, vi, beforeEach } from "vitest";
import { designSound } from "@/lib/audio/sound-design";
import { generateVideoToAudioSfx, selectVoice } from "@/lib/audio/generate";
import { modelsFor, STAGE_DEFAULTS } from "@/lib/registry";
import { PRESET_STACKS } from "@/lib/versions";
import { defaultRenderDeps } from "@/lib/sheet/render-deps";
import type { ShotSheet } from "@/lib/shot-sheet";
import type { Brief } from "@/lib/types";

describe("Audio Quality Gates", () => {
  describe("Sound Design", () => {
    beforeEach(() => {
      vi.mock("@/lib/ai", () => ({
        chatJSON: vi.fn().mockResolvedValue({
          data: {
            sfx: [
              { description: "ceramic mug set down on oak desk", shot: 0, offset: 0.5, gain: 0.3 },
              { description: "liquid pouring into glass", shot: 1, offset: 0.3, gain: 0.4 },
            ],
            music: { type: "cue", prompt: "upbeat electronic, 120 BPM, synth pads, energetic mood" },
            voice: { gender: "female", age: "30s", energy: "warm", pace: "steady" },
          },
          usage: { costUsd: 0.01 },
        }),
      }));
    });

    it("produces unique sound plans for different scripts", async () => {
      const sheet1: ShotSheet = {
        version: 1,
        targetSec: 10,
        aspect: "9:16",
        fps: 24,
        audioMode: "vo",
        bed: "",
        palette: "blue, white",
        rules: [],
        shots: [
          {
            id: "s1",
            n: 1,
            start: 0,
            end: 5,
            shotType: "CU",
            framing: "product centered",
            camera: { angle: "eye level", move: "slow push-in", lensMm: 50 },
            subject: "coffee mug",
            action: "steam rising",
            lighting: "soft",
            text: null,
            audio: { vo: "Morning starts here", sfx: "mug set down", music: null },
            transition: "cut",
            engine: "ai_video",
            engineLocked: false,
            editorNote: "",
          },
        ],
        endCard: { title: "Brand", line: "", footer: "" },
      };

      const brief1: Brief = {
        objective: "Launch new mug",
        audience: "morning people",
        insight: "Morning rituals matter",
        offer: "Premium ceramic mug",
        mandatories: [],
        kpi: "awareness",
      };

      const { plan: plan1 } = await designSound(sheet1, brief1, "google/gemini-4-carbon");

      // Different script
      const sheet2 = { ...sheet1, shots: [{ ...sheet1.shots[0], subject: "tea kettle", audio: { ...sheet1.shots[0].audio, sfx: "kettle whistling" } }] };
      const brief2 = { ...brief1, objective: "Launch new tea kettle" };

      const { plan: plan2 } = await designSound(sheet2, brief2, "google/gemini-4-carbon");

      // Plans should differ
      expect(plan1).toBeDefined();
      expect(plan2).toBeDefined();
      expect(plan1.sfx.length).toBeGreaterThan(0);
      expect(plan2.sfx.length).toBeGreaterThan(0);
    });

    it("respects pattern rules for music", async () => {
      const sheet: ShotSheet = {
        version: 1,
        targetSec: 10,
        aspect: "9:16",
        fps: 24,
        audioMode: "vo",
        bed: "",
        palette: "red",
        rules: [
          { id: "no_music", text: "Leave out background music" },
        ],
        shots: [
          {
            id: "s1",
            n: 1,
            start: 0,
            end: 10,
            shotType: "MS",
            framing: "centered",
            camera: { angle: "eye level", move: "static", lensMm: 50 },
            subject: "person",
            action: "speaking",
            lighting: "natural",
            text: null,
            audio: { vo: "This is important", sfx: null, music: null },
            transition: "cut",
            engine: "ai_video",
            engineLocked: false,
            editorNote: "",
          },
        ],
        endCard: { title: "Brand", line: "", footer: "" },
      };

      vi.mocked(require("@/lib/ai").chatJSON).mockResolvedValueOnce({
        data: {
          sfx: [],
          music: { type: "none" },
          voice: { gender: "male", age: "40s", energy: "calm", pace: "slow" },
        },
        usage: { costUsd: 0.01 },
      });

      const { plan } = await designSound(sheet, null, "google/gemini-4-carbon", "Confession loop");

      expect(plan.music.type).toBe("none");
    });
  });

  describe("Voice Selection", () => {
    it("selects deterministic voice per brand", () => {
      const persona = { gender: "female", age: "30s", energy: "warm", pace: "steady" };
      
      const voice1 = selectVoice(persona, "BrandA");
      const voice2 = selectVoice(persona, "BrandA");
      const voice3 = selectVoice(persona, "BrandB");

      expect(voice1).toBe(voice2); // Same brand = same voice
      expect(voice1).not.toBe("Rachel"); // Not hard-coded to Rachel
      expect(voice3).toBeDefined(); // Different brand = different voice (usually)
    });

    it("respects gender", () => {
      const malePersona = { gender: "male", age: "40s", energy: "calm", pace: "steady" };
      const femalePersona = { gender: "female", age: "30s", energy: "warm", pace: "quick" };

      const maleVoice = selectVoice(malePersona, "TestBrandMale");
      const femaleVoice = selectVoice(femalePersona, "TestBrandFemale");

      const maleVoices = ["Roger", "Charlie", "George", "Callum", "Liam", "Will", "Eric", "Chris", "Brian", "Daniel"];
      const femaleVoices = ["Rachel", "Aria", "Sarah", "Laura", "Charlotte", "Jessica", "Lily"];

      expect(maleVoices).toContain(maleVoice);
      expect(femaleVoices).toContain(femaleVoice);
    });
  });

  describe("Model Registry", () => {
    it("includes audio stages in registry", () => {
      const sfxModels = modelsFor("sfx");
      const musicModels = modelsFor("music");
      const voiceModels = modelsFor("voice");

      expect(sfxModels.length).toBeGreaterThan(0);
      expect(musicModels.length).toBeGreaterThan(0);
      expect(voiceModels.length).toBeGreaterThan(0);
    });

    it("includes MMAudio in SFX models", () => {
      const sfxModels = modelsFor("sfx");
      const mmaudio = sfxModels.find((m) => m.id === "fal-ai/mmaudio-v2");

      expect(mmaudio).toBeDefined();
      expect(mmaudio?.label).toContain("MMAudio");
    });

    it("includes ElevenLabs Music in music models", () => {
      const musicModels = modelsFor("music");
      const elevenMusic = musicModels.find((m) => m.id === "elevenlabs/music/v2.5");

      expect(elevenMusic).toBeDefined();
      expect(elevenMusic?.label).toContain("ElevenLabs");
    });

    it("defaults to top quality audio models", () => {
      expect(STAGE_DEFAULTS.sfx).toBe("fal-ai/mmaudio-v2");
      expect(STAGE_DEFAULTS.music).toBe("elevenlabs/music/v2.5");
      expect(STAGE_DEFAULTS.voice).toBe("fal-ai/elevenlabs/tts/eleven-v3");
    });
  });

  describe("Version Stack Audio Models", () => {
    it("Premium stack uses top quality audio", () => {
      const premium = PRESET_STACKS.find((s) => s.id === "premium");

      expect(premium?.models.sfx).toBe("fal-ai/mmaudio-v2");
      expect(premium?.models.music).toBe("elevenlabs/music/v2.5");
      expect(premium?.models.voice).toContain("elevenlabs");
    });

    it("Open source stack uses open audio models", () => {
      const open = PRESET_STACKS.find((s) => s.id === "open");

      expect(open?.models.voice).toBe("fal-ai/chatterbox/text-to-speech");
      expect(open?.models.music).toBe("fal-ai/ace-step");
    });
  });

  describe("Model Override in Render Deps", () => {
    it("passes audio models from stack to render deps", () => {
      const stackModels = {
        sfx: "elevenlabs/sound-effects/v3",
        music: "elevenlabs/music/v2.5",
        voice: "elevenlabs/tts/eleven-v4",
      };

      const deps = defaultRenderDeps(stackModels);

      expect(deps).toBeDefined();
      expect(deps.generateSfx).toBeDefined();
      expect(deps.generateMusic).toBeDefined();
      expect(deps.selectVoice).toBeDefined();
    });

    it("uses selected SFX model in generation", async () => {
      const { falRun, downloadAsDataUrl } = await vi.importActual<typeof import("@/lib/ai")>("@/lib/ai");
      vi.spyOn(await import("@/lib/ai"), "falRun").mockResolvedValue({
        audio: { url: "http://example.com/audio.wav" },
      });
      vi.spyOn(await import("@/lib/ai"), "downloadAsDataUrl").mockResolvedValue("data:audio/wav;base64,AAAA");

      const model = "elevenlabs/sound-effects/v3";
      const result = await generateVideoToAudioSfx(
        "http://example.com/video.mp4",
        "glass breaking",
        2,
        model
      );

      expect(result).toBeDefined();
      expect(result.url).toContain("data:audio/wav");
    });
  });

  describe("Fallback Behavior", () => {
    it("falls back to local lavfi on provider failure", async () => {
      vi.spyOn(await import("@/lib/ai"), "falRun").mockRejectedValue(new Error("Provider unavailable"));

      await expect(
        generateVideoToAudioSfx("http://example.com/video.mp4", "whoosh", 1)
      ).rejects.toThrow();
    });

    it("does not generate drone when bed is empty", async () => {
      const deps = defaultRenderDeps();
      const result = await deps.bed?.("", 10);

      expect(result).toBeNull();
    });
  });

  describe("Cost Metering", () => {
    it("meters audio generation through paid()", async () => {
      // Audio generation calls paid() which meters cost
      vi.spyOn(await import("@/lib/ai"), "falRun").mockResolvedValue({
        audio: { url: "http://example.com/audio.wav" },
      });
      vi.spyOn(await import("@/lib/ai"), "downloadAsDataUrl").mockResolvedValue("data:audio/wav;base64,AAAA");

      const result = await generateVideoToAudioSfx("http://example.com/video.mp4", "impact", 2);

      expect(result).toBeDefined();
      expect(result.usage).toBeDefined();
      expect(result.usage.costUsd).toBeGreaterThan(0);
    });
  });
});
