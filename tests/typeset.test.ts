import { execFileSync } from "node:child_process";
import fs from "node:fs";
import ffmpegPath from "ffmpeg-static";
import { describe, expect, it } from "vitest";
import { typesetStatic, wrapLines } from "../src/lib/video-post";

describe("typeset static ads", () => {
  it("wraps headlines to the line limit", () => {
    expect(wrapLines("Decorate your puja at home without a decorator quote", 20).every((l) => l.length <= 26)).toBe(true);
  });
  it("lays out headline, offer and CTA on the scene as a 1080x1350 PNG", async () => {
    execFileSync(ffmpegPath as string, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "gradients=s=900x1200:c0=0x7a4b2a:c1=0xe9c46a", "-frames:v", "1", "-y", "/tmp/typeset-bg.png"]);
    const bg = "data:image/png;base64," + fs.readFileSync("/tmp/typeset-bg.png").toString("base64");
    const out = await typesetStatic(bg, { brand: "Great Desi Celebration", headline: "Your puja, styled by you this weekend", offer: "From $249 a weekend", cta: "SHOP_NOW", primary: "#b5121b" });
    expect(out.startsWith("data:image/png;base64,")).toBe(true);
    const png = Buffer.from(out.split(",")[1], "base64");
    expect(png.readUInt32BE(16)).toBe(1080);
    expect(png.readUInt32BE(20)).toBe(1350);
    fs.writeFileSync("/tmp/typeset-sample.png", png);
  }, 30_000);
});
