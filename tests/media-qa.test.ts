import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { afterEach, describe, expect, it, vi } from "vitest";
import { audioFindings, checkExport, evidenceFrames, exportVerdict, frameTimes, localOcrAvailable, reusableShot, transcribeLine, verifySpeech, videoTechnicalFindings } from "@/lib/media-qa";
import { strictVideoBlock, videoReady } from "@/lib/quality-policy";
import { captionVariants, expectedCopy, placedCues, stitchShots } from "@/lib/video-post";
import type { Shot, ShotQA } from "@/lib/types";

const ff = promisify(execFile);
const pngSafeMp4 = async (filter: string, audio = "sine=frequency=440:sample_rate=44100") => {
  const { stdout } = await ff(ffmpegPath || "ffmpeg", [
    "-v", "error", "-f", "lavfi", "-i", filter, "-f", "lavfi", "-i", audio,
    "-t", "2", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "-",
  ], { encoding: "buffer", maxBuffer: 4 * 1024 * 1024 });
  return `data:video/mp4;base64,${stdout.toString("base64")}`;
};
const motion = "testsrc2=size=288x512:rate=30";

describe("local QA (no provider calls)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("checks all decoded frames for black and frozen sections", async () => {
    const black = await pngSafeMp4(`${motion},drawbox=color=black:t=fill:enable='between(t,0.7,1.1)'`);
    expect((await videoTechnicalFindings(black, 2)).some((f) => f.observed.includes("Black frames"))).toBe(true);
    const freeze = await pngSafeMp4(`${motion},trim=duration=0.6,tpad=stop_mode=clone:stop_duration=1.4`);
    expect((await videoTechnicalFindings(freeze, 2)).some((f) => f.observed.includes("frozen"))).toBe(true);
    const clean = await pngSafeMp4(motion);
    expect(await videoTechnicalFindings(clean, 2)).toEqual([]);
    expect((await evidenceFrames(clean, frameTimes(0, 2), { start: 0, end: 2 })).length).toBeGreaterThanOrEqual(5);
  }, 30_000);

  it("flags silent audio and a missing approved line in a specific window", async () => {
    vi.stubEnv("WHISPER_MODEL_PATH", undefined);
    const video = await pngSafeMp4(motion, "anullsrc=r=44100:cl=stereo");
    expect(await audioFindings(video, 2)).toMatchObject([{ status: "fail", observed: "No audible audio detected" }]);
    const heard = vi.fn().mockResolvedValueOnce({ text: "Save twenty dollars today.", usage: { costUsd: 0 } })
      .mockResolvedValueOnce({ text: "Order now", usage: { costUsd: 0 } });
    const results = await verifySpeech(video, [
      { start: 0, end: 1, text: "Save $20 today", shotId: "s0" },
      { start: 1, end: 2, text: "Order now for free shipping", shotId: "s1" },
    ], heard);
    expect(results.findings).toEqual([{
      kind: "speech", shotId: "s1", at: 1, expected: "Order now for free shipping", observed: "Order now", status: "fail",
    }]);
  }, 15_000);

  it("stitches locked timing and preserves audible, normalized narration", async () => {
    const input = await pngSafeMp4(motion);
    const { url, starts, duration } = await stitchShots([input, input], {
      width: 288, shotSeconds: [1, 1], voices: [{ url: input, start: 0.1, tempo: 1.3 }],
    });
    expect(starts).toEqual([0, 1]);
    expect(duration).toBe(2);
    expect(await videoTechnicalFindings(url, 2)).toEqual([]);
    expect(await audioFindings(url, 2)).toEqual([]);
  }, 30_000);

  it.skipIf(!process.env.TEST_WHISPER_WAV)("runs the configured local transcriber without contacting fal", async () => {
    const wav = await readFile(process.env.TEST_WHISPER_WAV!);
    const fallback = vi.fn().mockRejectedValue(new Error("Provider fallback not allowed in this test"));
    const result = await transcribeLine(`data:audio/wav;base64,${wav.toString("base64")}`, fallback);
    expect(result.text.toLowerCase()).toContain("ask not what your country can do for you");
    expect(result.usage.costUsd).toBe(0);
    expect(fallback).not.toHaveBeenCalled();
  }, 30_000);

  it("reads exact offer, captions and end card back from all aspect exports and rejects shortened copy", async (ctx) => {
    if (!await localOcrAvailable()) ctx.skip();
    const video = await pngSafeMp4(motion);
    const normalized = await stitchShots([video], { shotSeconds: [2], width: 288 });
    const segments = [{ start: 0, end: 2, text: "See the full offer", onScreen: "FREE SHIPPING ON ALL ORDERS" }];
    const card = { brand: "Example", cta: "Shop now" };
    const cues = expectedCopy(segments, card, 2);
    const variants = await captionVariants(normalized.url, "", card, segments, undefined, true);
    expect(variants.map((v) => v.aspect)).toEqual(["9:16", "4:5", "1:1"]);
    for (const v of variants) expect(await checkExport(v.url, v.aspect, 3.5, placedCues(v, cues))).toEqual([]);
    const [short] = await captionVariants(normalized.url, "", card, [{ ...segments[0], onScreen: "FREE SHIPPING" }], ["9:16"], true);
    const findings = await checkExport(short.url, short.aspect, 3.5, placedCues(short, cues).map((c) => c.layer === "overlay" ? { ...c, text: segments[0].onScreen } : c));
    expect(findings).toContainEqual(expect.objectContaining({ kind: "copy", expected: segments[0].onScreen, at: 1, status: "fail" }));
  }, 90_000);
});

describe("release and repair policy", () => {
  const pass: ShotQA = { score: 9, match: "pass", notes: [], frames: [{ at: 0.2, match: "pass", note: "" }] };
  const wrong: ShotQA = { score: 9, match: "fail", notes: ["Wrong product"], frames: [{ at: 1.4, match: "fail", note: "Red packaging, not the blue packaging from the reference" }] };
  const shot = { id: "s0", start: 0, end: 2, visual: "Show the blue pack", vo: "Shop now", onScreen: "" };

  it("blocks higher craft scores when semantic checks flag the wrong product or coverage is incomplete", () => {
    const aspects = ["9:16", "4:5", "1:1"];
    const quality = exportVerdict("final", 10, [{ ...shot, qa: wrong }], [], aspects);
    expect(videoReady(quality)).toBe(false);
    expect(quality.status).not.toBe("pass");
    const ok = { ...exportVerdict("final", 9, [{ ...shot, qa: pass }], [], aspects), storyboardKey: "sb0" };
    expect(strictVideoBlock({ mediaType: "video", quality: ok })).toBeNull();
    expect(strictVideoBlock({ mediaType: "video", quality: { ...ok, aspects: ["9:16"] } })).toBeTruthy();
    expect(strictVideoBlock({ mediaType: "video", quality: { ...ok, tier: "draft" } })).toContain("HD");
  });

  it("reuses only verified, unchanged takes", () => {
    const cache = { ...shot, clip: "/api/media/take.mp4", clipQa: pass, clipKey: "draft-v1", clipModel: "test" } as unknown as Shot;
    const failed = { ...cache, id: "s1", clipQa: wrong };
    const candidates = [cache, failed].filter((s) => !reusableShot(s, "draft-v1"));
    expect(candidates.map((s) => s.id)).toEqual(["s1"]);
    expect(reusableShot(cache, "changed-keyframe-or-model")).toBe(false);
  });
});
