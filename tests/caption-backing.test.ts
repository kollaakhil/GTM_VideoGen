import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { assFile, captionVariants } from "@/lib/video-post";
import { jobSteps } from "@/lib/job-progress";

const FF = (ffmpegPath as string) || "ffmpeg";
/** Mean luma of a region of the frame at `t` seconds (0 black … 255 white). */
function luma(file: string, t: number, x: number, y: number, w: number, h: number) {
  const raw = execFileSync(FF, ["-loglevel", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", `crop=${w}:${h}:${x}:${y},format=gray`, "-f", "rawvideo", "-"]);
  return raw.reduce((s, v) => s + v, 0) / raw.length;
}

describe("caption backing (compact OCR-safe copy)", () => {
  it("uses tight per-line semi-opaque boxes, not full-frame panels", () => {
    const ass = assFile([{ start: 0, end: 1, text: "Hi" }], 1080, 1920, [{ start: 0, end: 1, text: "35 Cal", layer: "overlay" }], true);
    const styles = ass.split("\n").filter((l) => l.startsWith("Style:"));
    expect(styles).toHaveLength(2);
    for (const s of styles) {
      const f = s.split(",");
      expect(f[7]).toBe("3"); // BorderStyle 3: opaque box hugging each line
      expect(f[3]).not.toBe("&H00000000"); // box is semi-opaque, never solid black
    }
  });

  it("leaves the frame clear around the text and while no line is on screen", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cap-back-"));
    const src = path.join(dir, "in.mp4");
    execFileSync(FF, ["-loglevel", "error", "-f", "lavfi", "-i", "color=c=white:size=360x640:rate=24:duration=3", "-pix_fmt", "yuv420p", "-y", src]);
    const segs = [{ start: 0, end: 1.2, text: "Hi there.", onScreen: "35 Cal" }];
    const [out] = await captionVariants(`data:video/mp4;base64,${fs.readFileSync(src).toString("base64")}`, "Hi there.", undefined, segs, ["9:16"], true);
    const file = path.join(dir, "out.mp4");
    fs.writeFileSync(file, Buffer.from(out.url.split(",")[1], "base64"));
    // The old fixed panels covered x 5–94%, y 56–82% (captions) and x 9–90%, y 12–44% (overlays) for the whole video.
    expect(luma(file, 0.6, 30, 380, 60, 40)).toBeGreaterThan(200); // left of the caption, inside the old panel
    expect(luma(file, 0.6, 40, 100, 50, 40)).toBeGreaterThan(200); // left of the overlay, inside the old panel
    expect(luma(file, 2.2, 20, 80, 320, 460)).toBeGreaterThan(240); // after the line ends nothing is drawn
    fs.rmSync(dir, { recursive: true });
  }, 60_000);
});

describe("video job step counter", () => {
  it("keeps one total per job so the counter never jumps", () => {
    expect(jobSteps("draft", 4)).toMatchObject({ total: 8, stitch: 6, qa: 7 });
    expect(jobSteps("draft", 4).shot(3)).toBe(5);
    const f = jobSteps("final", 4);
    expect(f).toMatchObject({ total: 7, stitch: 5, qa: 6 });
    expect(f.shot(3)).toBe(4); // last upscale, then stitch 5/7, QA 6/7
  });
});
