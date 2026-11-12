import { describe, expect, it } from "vitest";
import { falDurations, falError, falVideoBody } from "@/lib/ai";

describe("fal video", () => {
  const lite = "fal-ai/bytedance/seedance/v1/lite/image-to-video";
  it("sends Seedance drafts at 480p from the storyboard keyframe", () => {
    expect(falVideoBody(lite, "p", { firstFrame: "data:image/png;base64,AA", seconds: 3.4, resolution: "480p" })).toEqual({ prompt: "p", image_url: "data:image/png;base64,AA", duration: "3", resolution: "480p", aspect_ratio: "9:16" });
  });
  it("upgrades to 1080p on request", () => {
    expect(falVideoBody("fal-ai/bytedance/seedance/v1/pro/fast/image-to-video", "p", { resolution: "1080p", seconds: 6 })).toMatchObject({ resolution: "1080p", duration: "6" });
  });
  it("snaps Kling and Veo to their allowed lengths", () => {
    expect(falVideoBody("fal-ai/kling-video/v2.5-turbo/pro/image-to-video", "p", { seconds: 8 })).toMatchObject({ duration: "10" });
    expect(falVideoBody("fal-ai/veo3.1/fast/image-to-video", "p", { seconds: 5 })).toMatchObject({ duration: "4s" });
    expect(falDurations(lite)).toContain(2);
  });
  it("explains an empty balance", () => {
    expect(falError(403, '{"detail":"User is locked. Reason: Exhausted balance."}')).toMatch(/balance is empty/);
  });
});
