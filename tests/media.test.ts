import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
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

describe("spokenScript", () => {
  it("strips speaker labels and stage directions from captions", async () => {
    const { spokenScript } = await import("@/lib/video-post");
    expect(spokenScript('VO (CASUAL): "Your feet called." [beat] SFX: whoosh Shop now.')).toBe("Your feet called. whoosh Shop now.");
  });
});

describe("captionVariants end card", () => {
  it("appends a 1.5s typeset end card and keeps audio", async () => {
    const { captionVariants } = await import("@/lib/video-post");
    const file = path.join(os.tmpdir(), `end-${Date.now()}.mp4`);
    execFileSync(ffmpegPath || "ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=720x1280:rate=24:duration=2", "-f", "lavfi", "-i", "sine=duration=2", "-pix_fmt", "yuv420p", "-shortest", "-y", file]);
    const out = await captionVariants(`data:video/mp4;base64,${fs.readFileSync(file).toString("base64")}`, "Shop the sale.", { brand: "Allbirds", line: "Up to 70% off select styles", cta: "SHOP_NOW", color: "#f5e9d6" });
    const v = path.join(os.tmpdir(), `endv-${Date.now()}.mp4`);
    fs.writeFileSync(v, Buffer.from(out[0].url.split(",")[1], "base64"));
    const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", v]).toString());
    const streams = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", v]).toString();
    expect(dur).toBeGreaterThan(3.3);
    expect(streams).toContain("audio");
    fs.rmSync(file);
    fs.rmSync(v);
  }, 120_000);
});

describe("stitchShots", () => {
  it("joins clips with and without audio, mixes voice + music, returns shot starts", async () => {
    const { stitchShots, timedCues } = await import("@/lib/video-post");
    const ff = ffmpegPath || "ffmpeg";
    const tmp = (n: string) => path.join(os.tmpdir(), `st-${Date.now()}-${n}`);
    const a = tmp("a.mp4"), b = tmp("b.mp4"), v = tmp("v.wav"), m = tmp("m.wav");
    execFileSync(ff, ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=480x854:rate=24:duration=2", "-f", "lavfi", "-i", "sine=duration=2", "-pix_fmt", "yuv420p", "-shortest", "-y", a]);
    execFileSync(ff, ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=3", "-pix_fmt", "yuv420p", "-y", b]);
    execFileSync(ff, ["-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=4", "-y", v]);
    execFileSync(ff, ["-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=600:duration=2", "-y", m]);
    const d = (f: string, t: string) => `data:${t};base64,${fs.readFileSync(f).toString("base64")}`;
    const out = await stitchShots([d(a, "video/mp4"), d(b, "video/mp4")], { voices: [{ url: d(v, "audio/wav"), start: 0 }, { url: d(v, "audio/wav"), start: 2, tempo: 1.2 }], music: d(m, "audio/wav") });
    expect(out.starts[0]).toBe(0);
    expect(out.starts[1]).toBeCloseTo(2, 0);
    const o = tmp("o.mp4");
    fs.writeFileSync(o, Buffer.from(out.url.split(",")[1], "base64"));
    const info = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", o]).toString();
    const j = JSON.parse(info);
    expect(Number(j.format.duration)).toBeGreaterThan(4.5);
    expect(j.streams.find((s: { codec_type: string }) => s.codec_type === "video").width).toBe(720);
    expect(j.streams.some((s: { codec_type: string }) => s.codec_type === "audio")).toBe(true);
    const mean = Number(String(spawnSync(ff, ["-hide_banner", "-i", o, "-vn", "-af", "volumedetect", "-f", "null", "-"]).stderr).match(/mean_volume: ([-\d.]+) dB/)?.[1]);
    expect(mean).toBeGreaterThan(-60);
    expect(timedCues([{ start: 2, end: 4, text: "one two three four five" }])[0].start).toBe(2);
    for (const f of [a, b, v, m, o]) fs.rmSync(f);
  }, 180_000);
});
