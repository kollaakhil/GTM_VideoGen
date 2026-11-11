import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { brandStyle, filmstrip } from "@/lib/pipeline";

describe("brandStyle", () => {
  it("finds og:image and frequent brand colors", () => {
    const html = `<meta property="og:image" content="/og.png"><style>.a{color:#FF5500}.b{color:#ff5500}.c{background:#112233}.d{color:#ffffff}</style>`;
    const s = brandStyle(html, "https://brand.com/");
    expect(s.styleRef).toBe("https://brand.com/og.png");
    expect(s.colors[0]).toBe("#ff5500");
    expect(s.colors).not.toContain("#ffffff");
  });
});

describe("filmstrip", () => {
  it("samples keyframes from a video into one contact sheet", async () => {
    const file = path.join(os.tmpdir(), `qa-${Date.now()}.mp4`);
    execFileSync(ffmpegPath || "ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=360x640:rate=24:duration=6", "-pix_fmt", "yuv420p", "-y", file]);
    const { sheet, frames } = await filmstrip(`data:video/mp4;base64,${fs.readFileSync(file).toString("base64")}`);
    expect(sheet.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(frames[0]).toBe(0);
    expect(frames.length).toBeGreaterThanOrEqual(5);
    fs.rmSync(file);
  }, 60_000);
});

describe("captionVariants", () => {
  it("burns captions and renders 9:16, 4:5 and 1:1 cuts", async () => {
    const { captionVariants, captionCues } = await import("@/lib/video-post");
    expect(captionCues("one two three four five six", 6).length).toBe(2);
    const file = path.join(os.tmpdir(), `cap-${Date.now()}.mp4`);
    execFileSync(ffmpegPath || "ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=720x1280:rate=24:duration=3", "-pix_fmt", "yuv420p", "-y", file]);
    const out = await captionVariants(`data:video/mp4;base64,${fs.readFileSync(file).toString("base64")}`, "Comfort that sells itself. Shop the sale.");
    expect(out.map((o) => o.aspect)).toEqual(["9:16", "4:5", "1:1"]);
    const sq = path.join(os.tmpdir(), `sq-${Date.now()}.mp4`);
    fs.writeFileSync(sq, Buffer.from(out[2].url.split(",")[1], "base64"));
    const info = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", sq]).toString().trim();
    expect(info).toBe("720,720");
    fs.rmSync(file);
    fs.rmSync(sq);
  }, 120_000);
});
