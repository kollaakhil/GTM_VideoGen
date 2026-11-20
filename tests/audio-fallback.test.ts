import { describe, it, expect, vi, beforeEach } from "vitest";

// Must mock before importing to intercept module-level calls
vi.mock("@/lib/audio/generate", () => ({
  generateTextToAudioSfx: vi.fn(),
}));

vi.mock("@/lib/ai", () => ({
  musicBed: vi.fn(),
}));

import { generateSfxWithFallback, generateMusicWithFallback } from "@/lib/audio/fallback";
import { generateTextToAudioSfx } from "@/lib/audio/generate";
import { musicBed } from "@/lib/ai";

/**
 * Audio fallback tests: ensures audio generation never silently fails.
 * Tests the fallback chain with mocked model calls (zero spend, offline).
 */

describe("Audio Fallback Chain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe("SFX Fallback", () => {
    it("returns primary model result when available", async () => {
      const mockResult = {
        url: "data:audio/wav;base64,test",
        usage: { costUsd: 0.02 },
      };
      
      vi.mocked(generateTextToAudioSfx).mockResolvedValueOnce(mockResult);

      const result = await generateSfxWithFallback("whoosh", 2, "mirelo-ai/sfx2.0/text-to-audio");

      expect(result.url).toBe(mockResult.url);
      expect(result.warning).toBeUndefined();
    });

    it("falls back to next model when primary returns 404", async () => {
      const deprecatedError = {
        status: 404,
        message: "This endpoint is deprecated and no longer available",
      };
      const fallbackResult = {
        url: "data:audio/wav;base64,fallback",
        usage: { costUsd: 0.002 },
      };

      const mock = vi.mocked(generateTextToAudioSfx);
      // First call (deprecated model) fails
      mock.mockRejectedValueOnce(deprecatedError);
      // Second call (fallback) succeeds
      mock.mockResolvedValueOnce(fallbackResult);

      const result = await generateSfxWithFallback("whoosh", 2, "fal-ai/mmaudio-v2");

      expect(result.url).toBe(fallbackResult.url);
      expect(result.warning).toBeDefined();
      expect(result.warning?.stage).toBe("sfx");
      expect(result.warning?.primary).toBe("fal-ai/mmaudio-v2");
      expect(result.warning?.fallback).toContain("mirelo");
    });

    it("throws audioFallbackFailure when all models fail", async () => {
      const unavailableError = {
        status: 410,
        message: "Deprecated",
      };

      // Mock all calls to fail with deprecation error
      const mock = vi.mocked(generateTextToAudioSfx);
      mock.mockRejectedValue(unavailableError);

      try {
        await generateSfxWithFallback("whoosh", 2);
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.audioFallbackFailure).toBe(true);
        expect(error.stage).toBe("sfx");
        expect(error.primary).toBe("mirelo-ai/sfx2.0/text-to-audio");
        expect(error.message).toContain("All SFX models failed");
      }
      
      // Should have tried all models in the chain
      expect(mock.mock.calls.length).toBe(2); // mirelo + elevenlabs
    });

    it("throws error instead of generating silence", async () => {
      const error = { status: 410, message: "All models failed" };
      
      const mock = vi.mocked(generateTextToAudioSfx);
      mock.mockRejectedValue(error);

      try {
        await generateSfxWithFallback("whoosh", 2);
        expect.fail("Should have thrown an error");
      } catch (thrown: any) {
        expect(thrown.audioFallbackFailure).toBe(true);
        expect(thrown.message).toContain("All SFX models failed");
      }
    });

    it("throws non-availability errors without fallback", async () => {
      const authError = new Error("Unauthorized");
      
      vi.mocked(generateTextToAudioSfx).mockRejectedValueOnce(authError);

      await expect(generateSfxWithFallback("whoosh", 2)).rejects.toThrow("Unauthorized");
    });

    it("logs visible console errors when all models fail", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const deprecatedError = { status: 404, message: "Deprecated" };
      
      const mock = vi.mocked(generateTextToAudioSfx);
      mock.mockRejectedValue(deprecatedError);

      try {
        await generateSfxWithFallback("whoosh", 2);
        expect.fail("Should have thrown");
      } catch {
        // Expected
      }

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy.mock.calls.some(call => 
        call[0] && call[0].toString().includes("All SFX models failed")
      )).toBe(true);

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Music Fallback", () => {
    it("returns primary model result when available", async () => {
      vi.mocked(musicBed).mockResolvedValueOnce({ 
        url: "data:audio/wav;base64,music", 
        usage: { costUsd: 0.6 } 
      } as never);

      const result = await generateMusicWithFallback("upbeat", 10, "elevenlabs/music/v2.5");

      expect(result.url).toBe("data:audio/wav;base64,music");
      expect(result.warning).toBeUndefined();
    });

    it("falls back to next model when primary fails", async () => {
      const deprecatedError = { status: 410, message: "Deprecated" };
      
      const mock = vi.mocked(musicBed);
      mock.mockRejectedValueOnce(deprecatedError);
      mock.mockResolvedValueOnce({ 
        url: "data:audio/wav;base64,fallback-music", 
        usage: { costUsd: 0.6 } 
      } as never);

      const result = await generateMusicWithFallback("upbeat", 10, "fal-ai/deprecated-music");

      expect(result.url).toBe("data:audio/wav;base64,fallback-music");
      expect(result.warning).toBeDefined();
      expect(result.warning?.stage).toBe("music");
    });

    it("throws audioFallbackFailure when all models fail", async () => {
      const mock = vi.mocked(musicBed);
      mock.mockRejectedValue({ status: 404, message: "Not found" });

      try {
        await generateMusicWithFallback("upbeat", 10);
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.audioFallbackFailure).toBe(true);
        expect(error.stage).toBe("music");
        expect(error.message).toContain("All music models failed");
      }
      
      // Should have tried all models in the chain
      expect(mock.mock.calls.length).toBe(2); // elevenlabs + stable-audio-3/medium
    });
  });

  describe("Offline Operation", () => {
    it("generates audio without real API calls", async () => {
      vi.mocked(generateTextToAudioSfx).mockResolvedValueOnce({
        url: "data:audio/wav;base64,mock",
        usage: { costUsd: 0 },
      });

      const realFetch = global.fetch;
      global.fetch = vi.fn(() => {
        throw new Error("Real fetch called - test should be offline!");
      });

      try {
        await generateSfxWithFallback("test", 1);
        expect(global.fetch).not.toHaveBeenCalled();
      } finally {
        global.fetch = realFetch;
      }
    });
  });

  describe("Verified Model Chain", () => {
    it("only includes verified working models in SFX chain", async () => {
      // Test that we're only using verified models
      const mock = vi.mocked(generateTextToAudioSfx);
      // Mock all calls to fail
      mock.mockImplementation(async () => {
        throw { status: 410, message: "Deprecated" };
      });

      try {
        await generateSfxWithFallback("test", 1);
      } catch {
        // Expected to throw after trying all models
      }

      // Should have tried exactly 2 models: mirelo and elevenlabs
      expect(mock.mock.calls.length).toBe(2);
      expect(mock.mock.calls[0][2]).toBe("mirelo-ai/sfx2.0/text-to-audio");
      expect(mock.mock.calls[1][2]).toBe("elevenlabs/sound-effects/v3");
    });

    it("only includes verified working models in music chain", async () => {
      const mock = vi.mocked(musicBed);
      // Mock to fail for all calls
      mock.mockImplementation(async () => {
        throw { status: 410, message: "Deprecated" };
      });

      try {
        await generateMusicWithFallback("test", 10);
      } catch {
        // Expected to throw after trying all models
      }

      // Should have tried exactly 2 models: elevenlabs and stable-audio-3/medium
      expect(mock.mock.calls.length).toBe(2);
      expect(mock.mock.calls[0][1]).toBe(10); // duration
      expect(mock.mock.calls[0][2]).toBe("elevenlabs/music/v2.5");
      expect(mock.mock.calls[1][2]).toBe("fal-ai/stable-audio-3/medium/text-to-audio");
    });
  });
});
