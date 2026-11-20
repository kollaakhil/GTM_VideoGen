import { describe, it, expect } from "vitest";
import { selectVoice } from "@/lib/audio/generate";
import { modelsFor, STAGE_DEFAULTS } from "@/lib/registry";
import { PRESET_STACKS } from "@/lib/versions";

describe("Audio Quality Gates", () => {
  describe("Voice Selection", () => {
    it("selects deterministic voice per brand", () => {
      const persona = { gender: "female", age: "30s", energy: "warm", pace: "steady" };
      
      const voice1 = selectVoice(persona, "BrandA");
      const voice2 = selectVoice(persona, "BrandA");

      expect(voice1).toBe(voice2); // Same brand = same voice
      expect(typeof voice1).toBe("string");
    });

    it("respects gender for male personas", () => {
      const malePersona = { gender: "male", age: "40s", energy: "calm", pace: "steady" };
      const maleVoice = selectVoice(malePersona, "TestBrandMale");
      
      const maleVoices = ["Roger", "Charlie", "George", "Callum", "Liam", "Will", "Eric", "Chris", "Brian", "Daniel"];
      expect(maleVoices).toContain(maleVoice);
    });

    it("respects gender for female personas", () => {
      const femalePersona = { gender: "female", age: "30s", energy: "warm", pace: "quick" };
      const femaleVoice = selectVoice(femalePersona, "TestBrandFemale");
      
      const femaleVoices = ["Rachel", "Aria", "Sarah", "Laura", "Charlotte", "Jessica", "Lily"];
      expect(femaleVoices).toContain(femaleVoice);
      expect(femaleVoices).toContain("Rachel"); // sanity check
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

    it("includes Mirelo SFX 2.0 in SFX models", () => {
      const sfxModels = modelsFor("sfx");
      const mirelo = sfxModels.find((m) => m.id === "mirelo-ai/sfx2.0/text-to-audio");

      expect(mirelo).toBeDefined();
      expect(mirelo?.label).toContain("Mirelo");
    });

    it("includes ElevenLabs Music in music models", () => {
      const musicModels = modelsFor("music");
      const elevenMusic = musicModels.find((m) => m.id === "elevenlabs/music/v2.5");

      expect(elevenMusic).toBeDefined();
      expect(elevenMusic?.label).toContain("ElevenLabs");
    });

    it("defaults to top quality audio models", () => {
      expect(STAGE_DEFAULTS.sfx).toBe("mirelo-ai/sfx2.0/text-to-audio");
      expect(STAGE_DEFAULTS.music).toBe("elevenlabs/music/v2.5");
      expect(STAGE_DEFAULTS.voice).toBe("fal-ai/elevenlabs/tts/eleven-v3");
    });
  });

  describe("Version Stack Audio Models", () => {
    it("Premium stack uses top quality audio", () => {
      const premium = PRESET_STACKS.find((s) => s.id === "premium");

      expect(premium?.models.sfx).toBe("mirelo-ai/sfx2.0/text-to-audio");
      expect(premium?.models.music).toBe("elevenlabs/music/v2.5");
      expect(premium?.models.voice).toContain("elevenlabs");
    });

    it("Open source stack uses open audio models", () => {
      const open = PRESET_STACKS.find((s) => s.id === "open");

      expect(open?.models.voice).toBe("fal-ai/chatterbox/text-to-speech");
      expect(open?.models.music).toBe("fal-ai/ace-step");
    });
  });
});
