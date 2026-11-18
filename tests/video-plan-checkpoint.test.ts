import { describe, expect, it } from "vitest";
import { normWords, parseSceneList, wordErrorRate } from "@/lib/qa-tools";
import { plateAngle, realSetStatus } from "@/lib/real-set";
import { lookLine, musicPrompt } from "@/lib/video-looks";

describe("word-level QA", () => {
  it("normalises words like jiwer's default transform", () => {
    expect(normWords("Don’t wait, it's $49.99!")).toEqual(["dont", "wait", "its", "49", "99"]);
  });
  it("computes word error rate", () => {
    expect(wordErrorRate("warm hands in under a minute", "warm hands in under a minute")).toBe(0);
    expect(wordErrorRate("warm hands in under a minute", "warm hand in under minute")).toBeCloseTo(2 / 6);
    expect(wordErrorRate("", "")).toBe(0);
    expect(wordErrorRate("", "noise")).toBe(1);
  });
  it("reads PySceneDetect's timecode list", () => {
    const log = "[PySceneDetect] Detected 3 scenes\n[PySceneDetect] Comma-separated timecode list:\n  00:00:02.000,00:00:04.500\n";
    expect(parseSceneList(log)).toEqual([2, 4.5]);
    expect(parseSceneList("[PySceneDetect] Detected 1 scenes")).toEqual([]);
  });
});

describe("video looks", () => {
  it("lets a shot lens override the plan lens and adds the grade", () => {
    expect(lookLine({ lens: "wide24", visualStyle: "cinematic" }, { lens: "macro100" })).toMatch(/100mm macro.*Grade: cinematic/);
    expect(lookLine({ lens: "auto", visualStyle: "natural" }, null)).toBe("");
  });
  it("builds a music prompt from the chosen style", () => {
    expect(musicPrompt({ musicStyle: "lofi" }, "Product demo", "calm")).toMatch(/lo-fi.*Product demo.*no vocals/);
    expect(musicPrompt({ musicStyle: "auto" }, "Product demo")).toMatch(/^Clean instrumental/);
  });
});

describe("real set", () => {
  it("degrades with a clear message when it is off or has no key", () => {
    const prev = { flag: process.env.REAL_SET, key: process.env.WORLDLABS_API_KEY };
    delete process.env.REAL_SET;
    expect(realSetStatus()).toEqual({ available: false, reason: expect.stringMatching(/REAL_SET=1/) });
    process.env.REAL_SET = "1";
    delete process.env.WORLDLABS_API_KEY;
    expect(realSetStatus().reason).toMatch(/WORLDLABS_API_KEY/);
    process.env.WORLDLABS_API_KEY = "test";
    expect(realSetStatus()).toEqual({ available: true, reason: null });
    process.env.REAL_SET = prev.flag;
    process.env.WORLDLABS_API_KEY = prev.key;
    if (prev.flag === undefined) delete process.env.REAL_SET;
    if (prev.key === undefined) delete process.env.WORLDLABS_API_KEY;
  });
  it("varies plate angles like coverage", () => {
    expect(plateAngle(0, "slow push-in")).toEqual({ yaw: 0, pitch: -4 });
    expect(plateAngle(1, "top-down static").pitch).toBe(-60);
    expect(plateAngle(3, "slow pan").yaw).toBe(160);
  });
});
