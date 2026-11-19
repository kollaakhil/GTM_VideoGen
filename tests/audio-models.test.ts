import { describe, expect, it } from "vitest";
import { MUSIC_COST, MUSIC_MODEL, VOICE_MODEL } from "@/lib/ai";
import { musicPrompt } from "@/lib/video-looks";
import { estimateCost } from "@/lib/video-categories";

describe("audio models (13.29 A/B winners)", () => {
  it("uses Eleven v3 for voice and Stable Audio 2.5 for music", () => {
    expect(VOICE_MODEL).toBe("fal-ai/elevenlabs/tts/eleven-v3");
    expect(MUSIC_MODEL).toBe("fal-ai/stable-audio-25/text-to-audio");
    expect(MUSIC_COST).toBe(0.2);
  });
  it("asks for a steady tempo, room for the voice and an ending button", () => {
    const p = musicPrompt({ musicStyle: undefined }, "beverage", "playful");
    expect(p).toMatch(/\d+ BPM/);
    expect(p).toMatch(/voiceover sits on top/);
    expect(p).toMatch(/ending button/);
    expect(p).toMatch(/no vocals/);
  });
  it("budgets music at the Stable Audio price", () => {
    expect(estimateCost("video", { lengthSec: 10, shots: 0, music: true }) - estimateCost("video", { lengthSec: 10, shots: 0 })).toBeCloseTo(0.2);
  });
});
