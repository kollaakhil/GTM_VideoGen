import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { describe, expect, it } from "vitest";
import { planAudio, foleyActions, type AudioShot } from "@/lib/audio/mode";
import { sfxFile, type SfxKind } from "@/lib/sfx";
import { loudness } from "@/lib/qa-tools";
import { meanVolume, stitchShots } from "@/lib/video-post";

const sheet: AudioShot[] = [
  { seconds: 3, sfx: "switch clicks, light slides across the plate", beats: ["0.4–1s switch clicks"], vo: "Every detail." },
  { seconds: 4, sfx: "can cracks open then cola pours and fizzes", vo: null },
  { seconds: 2, sfx: "mystery warble", vo: null },
];

describe("planAudio", () => {
  it("foley: no voice, one effect per action in the sheet, ducked bed", () => {
    const p = planAudio("foley", sheet);
    expect(p.voice).toBe(false);
    expect(p.duck).toBe(true);
    const kinds = (n: number) => p.sfx.filter((c) => c.shot === n && c.kind !== "whoosh").map((c) => c.kind);
    expect(kinds(0)).toEqual(["click", "slide"]);
    expect(kinds(1)).toEqual(["pop", "pour", "fizz"]);
    expect(p.sfx.filter((c) => c.kind === "whoosh")).toHaveLength(2);
  });
  it("times the effect to its beat when the sheet gives one, else spreads the actions across the shot", () => {
    const p = planAudio("foley", sheet);
    expect(p.sfx.find((c) => c.shot === 0 && c.kind === "click")!.offset).toBe(0.4);
    const [pop, pour, fizz] = p.sfx.filter((c) => c.shot === 1);
    expect(pop.offset).toBeLessThan(pour.offset);
    expect(pour.offset).toBeLessThan(fizz.offset);
    expect(fizz.offset).toBeLessThan(4 - 0.2);
  });
  it("reports actions it has no sound for instead of dropping them silently", () => {
    const p = planAudio("foley", sheet);
    expect(p.unmapped).toEqual(["shot 3: “mystery warble”"]);
    expect(p.coverage).toEqual({ actions: 6, covered: 5 });
  });
  it("both: voice and effects, effects a little lower than foley-only, bed ducked", () => {
    const f = planAudio("foley", sheet), b = planAudio("both", sheet);
    expect(b.voice).toBe(true);
    expect(b.duck).toBe(true);
    expect(b.sfx.find((c) => c.kind === "pop")!.gain).toBeLessThan(f.sfx.find((c) => c.kind === "pop")!.gain);
  });
  it("vo: the classic mix, voice on, bed not ducked, only the original effects", () => {
    const p = planAudio("vo", sheet);
    expect(p.voice).toBe(true);
    expect(p.duck).toBe(false);
    expect(p.bedGain).toBe(0.18);
    // No more automatic whoosh on cuts, and all SFX kinds are allowed (not just legacy cola sounds)
    expect(new Set(p.sfx.map((c) => c.kind))).toEqual(new Set(["pop", "pour", "fizz", "click", "slide"]));
  });
  it("derives actions from the picture when a row has no sound line", () => {
    expect(foleyActions({ seconds: 3, visual: "a hand cracks the can open, foam rises" })).toEqual(["pop", "fizz"]);
  });
});

describe("foley synthesis and ducking (real FFmpeg)", () => {
  it("every new effect is audible", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "foley-"));
    for (const k of ["click", "thud", "slide", "sizzle"] as SfxKind[]) {
      const db = await meanVolume(`data:audio/wav;base64,${(await fs.readFile(await sfxFile(k, dir))).toString("base64")}`);
      expect(db, k).toBeGreaterThan(-50);
    }
    await fs.rm(dir, { recursive: true, force: true });
  }, 40_000);

  it("stitches foley over a sidechain-ducked bed: a valid mix that differs from the unducked one", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "duck-"));
    const ff = (args: string[]) => execFileSync(ffmpegPath as string, ["-hide_banner", "-loglevel", "error", "-y", ...args]);
    const clip = path.join(dir, "c.mp4");
    ff(["-f", "lavfi", "-i", "color=c=black:s=320x568:d=2:r=30", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", clip]);
    const bed = path.join(dir, "bed.mp3");
    ff(["-f", "lavfi", "-i", "sine=f=220:d=4", "-ac", "2", bed]);
    const data = async (f: string, mime: string) => `data:${mime};base64,${(await fs.readFile(f)).toString("base64")}`;
    const [c, m] = [await data(clip, "video/mp4"), await data(bed, "audio/mpeg")];
    const plan = planAudio("foley", [{ seconds: 2, sfx: "tap, then switch clicks" }, { seconds: 2, sfx: "can cracks" }]);
    const base = { music: m, shotSeconds: [2, 2], width: 320, beatSync: false, sfx: plan.sfx, bedGain: plan.bedGain };
    const plain = await stitchShots([c, c], base);
    const ducked = await stitchShots([c, c], { ...base, duck: plan.duck });
    expect(ducked.duration).toBeCloseTo(plain.duration, 1);
    const level = await loudness(ducked.url);
    expect(level && level.lufs).toBeGreaterThan(-24); // audible, and loudnorm still ran (4 s clips land near, not on, -14)
    expect(level && level.peak).toBeLessThan(0);
    const [a, b] = [await meanVolume(ducked.url), await meanVolume(plain.url)];
    expect(a).toBeGreaterThan(-60);
    expect(a).not.toBeCloseTo(b, 3); // the sidechain changed the mix
  }, 120_000);
});
