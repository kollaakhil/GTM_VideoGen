import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { CAPTION_SLOTS, duplicateOverlay, layoutCopy, overlaps, pickSlot, shotOverlays, textBox, type EnergyMap } from "@/lib/caption-layout";
import { captionVariants, expectedCopy } from "@/lib/video-post";
import { ocrFilter } from "@/lib/media-qa";

const FF = (ffmpegPath as string) || "ffmpeg";

/** Energy map with a busy "product" rectangle (fractions of the frame) and quiet everywhere else. */
function mapWith(rect: { x0: number; x1: number; y0: number; y1: number }, frames = 6): EnergyMap {
  const gw = 36, gh = 64;
  const f = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const fx = (x + 0.5) / gw, fy = (y + 0.5) / gh;
    f[y * gw + x] = fx >= rect.x0 && fx <= rect.x1 && fy >= rect.y0 && fy <= rect.y1 ? 200 : 4;
  }
  return { gw, gh, fps: 2, frames: Array.from({ length: frames }, () => f) };
}

describe("caption layout keeps copy off the product", () => {
  it("keeps the default lower-third slot when the frame is quiet", () => {
    const p = pickSlot(mapWith({ x0: 2, x1: 2, y0: 2, y1: 2 }), CAPTION_SLOTS, textBox("Get notified at", 40, 540, 960), 0, 3);
    expect(p.y).toBe(CAPTION_SLOTS[0]);
  });

  it("moves the caption off a can that sits in the lower third (OLIPOP 13.5 s regression)", () => {
    // The can in the OLIPOP CTA shot spans roughly x 25–47%, y 64–88% of the 9:16 frame.
    const can = { x0: 0.25, x1: 0.47, y0: 0.64, y1: 0.88 };
    const size = textBox("drinkolipop.com.", 40, 540, 960);
    const p = pickSlot(mapWith(can), CAPTION_SLOTS, size, 0, 3);
    const canBox = { x: can.x0, y: can.y0, w: can.x1 - can.x0, h: can.y1 - can.y0 };
    expect(overlaps(p.box, canBox)).toBe(false);
    expect(p.box.y).toBeGreaterThanOrEqual(0.08);
    expect(p.box.y + p.box.h).toBeLessThanOrEqual(0.8);
  });

  it("never stacks the overlay and the caption, and drops an overlay that repeats the voice line", () => {
    expect(duplicateOverlay("Get notified at drinkolipop.com", "Get notified at drinkolipop.com.")).toBe(true);
    expect(duplicateOverlay("6g Dietary Fiber", "Pomegranate, quince and passion fruit sparkle.")).toBe(false);
    const segments = [
      { start: 0, end: 4, text: "Pomegranate, quince and passion fruit sparkle.", onScreen: "6g Dietary Fiber" },
      { start: 4, end: 8, text: "Get notified at drinkolipop.com.", onScreen: "Get notified at drinkolipop.com" },
    ];
    expect(shotOverlays(segments)).toHaveLength(1);
    expect(expectedCopy(segments, { brand: "OLIPOP" }, 8).filter((c) => c.layer === "overlay")).toHaveLength(1);
    // Busy band right where the overlay would go by default: both must still find separate quiet slots.
    const map = mapWith({ x0: 0.1, x1: 0.9, y0: 0.1, y1: 0.24 });
    const { overlays, captions } = layoutCopy(map, 540, 960, segments, [{ start: 0, end: 2, text: "Pomegranate, quince and" }, { start: 2, end: 4, text: "passion fruit sparkle." }], { caption: 40, overlay: 32 });
    for (const c of captions.filter((c) => c.start < 4)) for (const o of overlays) expect(overlaps(c.box, o.box)).toBe(false);
    expect(captions[0].y).toBe(captions[1].y); // one slot per shot, no hopping
  });

  it("OCR reads only the placed, binarised box", () => {
    const f = ocrFilter({ start: 0, end: 1, text: "x", layer: "caption", box: { x: 0.2, y: 0.3, w: 0.6, h: 0.05 } });
    expect(f).toContain("crop=iw*0.6240:ih*0.0740:iw*0.1880:ih*0.2880");
    expect(f).toContain("lutyuv");
    expect(ocrFilter({ start: 0, end: 1, text: "x", layer: "caption" })).toContain("ih*0.58");
  });

  it("renders the caption away from a detailed product in the real export (pixels)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cap-layout-"));
    const src = path.join(dir, "in.mp4");
    // Flat grey set with a detailed "can" (testsrc2) at x 120–240, y 400–550 of 360×640: right under the default caption.
    execFileSync(FF, ["-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x404040:s=360x640:r=24:d=3", "-f", "lavfi", "-i", "testsrc2=s=120x150:r=24:d=3",
      "-filter_complex", "[0][1]overlay=120:400:shortest=1", "-pix_fmt", "yuv420p", "-y", src]);
    const plain = path.join(dir, "plain.png");
    execFileSync(FF, ["-loglevel", "error", "-ss", "1", "-i", src, "-frames:v", "1", "-vf", "crop=120:150:120:400,format=gray", "-f", "rawvideo", "-y", plain]);
    const segs = [{ start: 0, end: 3, text: "Get notified at drinkolipop.com." }];
    const [out] = await captionVariants(`data:video/mp4;base64,${fs.readFileSync(src).toString("base64")}`, "", undefined, segs, ["9:16"]);
    const file = path.join(dir, "out.mp4");
    fs.writeFileSync(file, Buffer.from(out.url.split(",")[1], "base64"));
    const after = execFileSync(FF, ["-loglevel", "error", "-ss", "1", "-i", file, "-frames:v", "1", "-vf", "crop=120:150:120:400,format=gray", "-f", "rawvideo", "-"]);
    const before = fs.readFileSync(plain);
    let diff = 0;
    for (let i = 0; i < before.length; i++) diff += Math.abs(before[i] - after[i]);
    expect(diff / before.length).toBeLessThan(12); // only re-encode noise: no caption box over the can
    const cap = out.copy!.find((c) => c.layer === "caption")!;
    expect(overlaps(cap.box!, { x: 120 / 360, y: 400 / 640, w: 120 / 360, h: 150 / 640 })).toBe(false);
    fs.rmSync(dir, { recursive: true });
  }, 60_000);
});
