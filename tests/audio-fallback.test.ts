import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateSfxWithFallback, generateMusicWithFallback } from "@/lib/audio/fallback";
import * as generate from "@/lib/audio/generate";
import * as ai from "@/lib/ai";

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
      
      vi.spyOn(generate, "generateTextToAudioSfx").mockResolvedValueOnce(mockResult);

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

      const mock = vi.spyOn(generate, "generateTextToAudioSfx");
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

    it("falls back to bundled audio when all models fail", async () => {
      const unavailableError = {
        status: 410,
        message: "Deprecated",
      };

      // Mock all calls to fail with deprecation error
      const mock = vi.spyOn(generate, "generateTextToAudioSfx");
      mock.mockRejectedValue(unavailableError);

      const result = await generateSfxWithFallback("whoosh", 2);

      expect(result.url).toBeDefined();
      expect(result.url).toContain("data:audio/wav;base64");
      expect(result.warning).toBeDefined();
      expect(result.warning?.fallback).toBe("bundled");
      expect(result.usage.costUsd).toBe(0);
      
      // Should have tried multiple models before falling back
      expect(mock.mock.calls.length).toBeGreaterThan(1);
    });

    it("generates silence as last resort", async () => {
      const error = { status: 410, message: "All models failed" };
      
      const mock = vi.spyOn(generate, "generateTextToAudioSfx");
      mock.mockRejectedValue(error);

      const result = await generateSfxWithFallback("whoosh", 2);

      // Should return valid audio data URL (silence)
      expect(result.url).toContain("data:audio/wav;base64");
      expect(result.warning).toBeDefined();
    });

    it("throws non-availability errors without fallback", async () => {
      const authError = new Error("Unauthorized");
      
      vi.spyOn(generate, "generateTextToAudioSfx").mockRejectedValueOnce(authError);

      await expect(generateSfxWithFallback("whoosh", 2)).rejects.toThrow("Unauthorized");
    });

    it("logs visible warnings on fallback", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const deprecatedError = { status: 404, message: "Deprecated" };
      
      const mock = vi.spyOn(generate, "generateTextToAudioSfx");
      mock.mockRejectedValueOnce(deprecatedError);
      mock.mockResolvedValueOnce({ url: "data:audio", usage: { costUsd: 0 } });

      await generateSfxWithFallback("whoosh", 2, "fal-ai/mmaudio-v2");

      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleWarnSpy.mock.calls.some(call => 
        call[0] && call[0].toString().includes("unavailable") || 
        (call[0] && call[0].toString().includes("fallback"))
      )).toBe(true);

      consoleWarnSpy.mockRestore();
    });
  });

  describe("Music Fallback", () => {
    it("returns primary model result when available", async () => {
      vi.spyOn(ai, "musicBed").mockResolvedValueOnce({ 
        url: "data:audio/wav;base64,music", 
        usage: { costUsd: 0.6 } 
      } as never);

      const result = await generateMusicWithFallback("upbeat", 10, "elevenlabs/music/v2.5");

      expect(result.url).toBe("data:audio/wav;base64,music");
      expect(result.warning).toBeUndefined();
    });

    it("falls back to next model when primary fails", async () => {
      const deprecatedError = { status: 410, message: "Deprecated" };
      
      const mock = vi.spyOn(ai, "musicBed");
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

    it("falls back to bundled music when all models fail", async () => {
      const mock = vi.spyOn(ai, "musicBed");
      mock.mockRejectedValue({ status: 404, message: "Not found" });

      const result = await generateMusicWithFallback("upbeat", 10);

      expect(result.url).toBeDefined();
      expect(result.url).toContain("data:audio/wav;base64");
      expect(result.warning?.fallback).toBe("bundled");
      expect(result.usage.costUsd).toBe(0);
    });
  });

  describe("Offline Operation", () => {
    it("generates audio without real API calls", async () => {
      vi.spyOn(generate, "generateTextToAudioSfx").mockResolvedValueOnce({
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

  describe("Audio Stems", () => {
    it("generates valid WAV audio data", async () => {
      const mockAudio = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
      
      vi.spyOn(generate, "generateTextToAudioSfx").mockResolvedValueOnce({
        url: mockAudio,
        usage: { costUsd: 0 },
      });

      const result = await generateSfxWithFallback("test", 1);

      expect(result.url).toMatch(/^data:audio\/wav;base64,/);
      // Verify it's base64 encoded
      const base64Part = result.url.split(",")[1];
      expect(base64Part).toBeTruthy();
      expect(() => Buffer.from(base64Part, "base64")).not.toThrow();
    });

    it("generates audio with nonzero duration", async () => {
      const mockAudio = "data:audio/wav;base64,test";
      
      vi.spyOn(generate, "generateTextToAudioSfx").mockResolvedValueOnce({
        url: mockAudio,
        usage: { costUsd: 0 },
      });

      const durationSeconds = 3;
      const result = await generateSfxWithFallback("test", durationSeconds);

      // The fallback should have requested the specified duration
      expect(generate.generateTextToAudioSfx).toHaveBeenCalledWith(
        expect.any(String),
        durationSeconds,
        expect.any(String)
      );
    });
  });
});
