import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { onBeatShare, snapCuts } from "@/lib/beat-sync";
import { sfxCues, sfxFile, type SfxKind } from "@/lib/sfx";
import { editChecks } from "@/lib/stage-gates";
import { meanVolume } from "@/lib/video-post";
import type { Shot } from "@/lib/types";

const shot = (visual: string, seconds = 4, motionBeats?: string[]): Shot => ({ id: "s", beat: "b", seconds, visual, camera: "c", vo: "", status: "planned", ...(motionBeats ? { spec: { subject: "", productFraming: "", lensMm: 50, cameraMove: "", lighting: "", setting: "", motionBeats, negative: [] } } : {}) });

describe("beat-synced cuts", () => {
  it("moves cuts to the nearest beat inside the window and never past clip slack", () => {
    const r = snapCuts([3, 4, 4], [2.9, 3.2, 7.1, 10], [5, 5, 5]);
    expect(r.seconds[0]).toBeCloseTo(2.9); // 3 → 2.9 (earlier, within 0.15)
    expect(r.seconds[0] + r.seconds[1]).toBeCloseTo(7.1);
    expect(r.seconds[2]).toBe(4);
    expect(r.snapped).toBe(2);
    expect(snapCuts([3, 4], [3.2], [3.05, 5]).seconds[0]).toBe(3); // no slack to grow into
    expect(snapCuts([3, 4], [3.5]).seconds[0]).toBe(3); // too far
  });
  it("scores share of cuts on the beat in the edit gate", () => {
    expect(onBeatShare([3, 7], [3.02, 9])).toBe(0.5);
    const rows = editChecks({ planned: [3], detected: [3], shotSeconds: [3, 4], beatSeconds: [3, 4], wordsPerShot: [3, 3], continuity: null, onBeat: 1 });
    expect(rows.find((r) => r.name === "cuts on music beats")?.score).toBe(10);
  });
});

describe("shot-driven SFX", () => {
  it("cues pop, pour, fizz by shot content, timed to motion beats, and whooshes into cuts", () => {
    const cues = sfxCues([shot("a hand cracks the can open"), shot("cola pours over ice, fizz rises", 4, ["0–1s hand tilts can", "1.2–3s cola pours into the glass"])]);
    expect(cues.map((c) => `${c.kind}@${c.shot}:${c.offset}`)).toEqual(["pop@0:0.3", "pour@1:1.2", "fizz@1:2", "clink@1:0.5", "whoosh@1:-0.22"]);
  });
  it("synthesises every sound locally and none are silent", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sfx-"));
    for (const k of ["whoosh", "pop", "fizz", "pour", "clink"] as SfxKind[]) {
      const f = await sfxFile(k, dir);
      const db = await meanVolume(`data:audio/wav;base64,${(await fs.readFile(f)).toString("base64")}`);
      expect(db, k).toBeGreaterThan(-45);
    }
    await fs.rm(dir, { recursive: true, force: true });
  }, 30_000);
});
