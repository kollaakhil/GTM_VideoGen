import { describe, expect, it } from "vitest";
import { higgsfieldBody, higgsfieldDurations, higgsfieldError, parseHiggsfieldRates, pickRate } from "@/lib/ai";

describe("higgsfield", () => {
  it("sends 480p drafts and 1080p upgrades to Seedance with the first frame", () => {
    const e = "bytedance/seedance-2.0/image-to-video";
    expect(higgsfieldBody(e, "p", { resolution: "480p", seconds: 3 }, "https://x/a.png")).toMatchObject({ resolution: "480p", duration: 4, image_url: "https://x/a.png" });
    expect(higgsfieldBody(e, "p", { resolution: "1080p", seconds: 6 })).toMatchObject({ resolution: "1080p", duration: 6 });
  });
  it("uses Kling's sound flag and no resolution", () => {
    const b = higgsfieldBody("kling-video/v3.0/std/image-to-video", "p", { audio: false, seconds: 12 });
    expect(b).toMatchObject({ sound: "off", duration: 10 });
    expect(b.resolution).toBeUndefined();
    expect(higgsfieldDurations("higgsfield:kling-video/v3.0/std/text-to-video")).toContain(3);
  });
  it("explains an empty balance", () => {
    expect(higgsfieldError(403, '{"detail":"not_enough_credits"}')).toMatch(/balance is empty/);
  });
  it("picks the closest available rate at or above the request", () => {
    expect(pickRate({ "720p": 0.07 }, "480p")).toEqual({ rate: 0.07, resolution: "720p" });
    expect(pickRate({ "480p": 0.08, "1080p": 0.43 }, "1080p")).toEqual({ rate: 0.43, resolution: "1080p" });
    expect(pickRate(null, "480p")).toBeNull();
  });
  it("parses Higgsfield's estimate text, including a trailing period", () => {
    expect(parseHiggsfieldRates("rates per second: 480p: $0.1177; 1080p: $0.6518. Total price")).toEqual({ "480p": 0.1177, "1080p": 0.6518 });
  });
});
