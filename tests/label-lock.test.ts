import { describe, expect, it } from "vitest";
import { applyLabelLock, continuityLocks, enforceShotRules, glassLock, labelLockGaps, labelled, movesProduct, specBlock, specGaps, OFF_FRAME_POUR } from "@/lib/shot-spec";
import { CONTINUITY_LOCK_ASK } from "@/lib/stage-gates";
import type { Shot } from "@/lib/types";

const shot = (over: Partial<Shot> & { beats?: string[]; framing?: string; setting?: string } = {}): Shot => ({
  id: "s0", beat: "hook", seconds: 3, vo: "", status: "planned",
  visual: over.visual ?? "A hand cracks the OLIPOP can, label facing the lens. Dark cola pours from the can into an ice-filled tumbler. Warm light.",
  camera: over.camera ?? "slow push-in",
  source: over.source,
  spec: {
    subject: "one hand", productFraming: over.framing ?? "can at 35% of frame height, real label square to camera", lensMm: 85,
    cameraMove: "slow 10% push-in", lighting: "warm key", setting: over.setting ?? "holiday table, an ice-filled short tumbler",
    motionBeats: over.beats ?? ["0–0.8s hand cracks the tab", "0.8–3s the hand tips the can sideways toward the glass; cola streams over ice"], negative: [],
  },
});

describe("label lock", () => {
  it("detects product moves, but not off-frame pours or still cans", () => {
    expect(movesProduct("0.8–3s the hand tips the can toward the glass")).toBe(true);
    expect(movesProduct("hand tilts the bottle")).toBe(true);
    expect(movesProduct("cola pours from the can into the glass")).toBe(true);
    expect(movesProduct("cola pours into the glass from a can held above, out of frame")).toBe(false);
    expect(movesProduct("1.2–3s hand withdraws, the can stays still and readable")).toBe(false);
    expect(movesProduct("0–0.8s hand cracks the tab")).toBe(false);
  });

  it("flags tilting beats in the shot-plan gate for labelled shots only", () => {
    expect(labelLockGaps(shot())).toHaveLength(1);
    expect(specGaps(shot()).some((g) => g.includes("must not move"))).toBe(true);
    expect(labelLockGaps(shot({ source: "packshot" }))).toEqual([]);
    expect(labelled(shot({ framing: "no product, hands only", visual: "hands only" }))).toBe(false);
  });

  it("rewrites a tilt-pour into an upright can plus an off-frame pour with a locked camera", () => {
    const s = applyLabelLock(shot());
    expect(s.spec!.motionBeats[0]).toBe("0–0.8s hand cracks the tab");
    expect(s.spec!.motionBeats[1]).toMatch(/^0\.8–3s the labelled can stands upright and still beside the glass.*out of frame/);
    expect(s.spec!.motionBeats.some(movesProduct)).toBe(false);
    expect(s.visual).not.toMatch(/pours from the can/);
    expect(s.visual).toContain(OFF_FRAME_POUR);
    expect(s.camera).toBe("locked off, no camera move");
    expect(s.spec!.cameraMove).toBe("locked off, no camera move");
    expect(s.spec!.productFraming).toMatch(/always upright/);
    expect(s.spec!.motionBeats.join(" ")).not.toMatch(/tilt|tip/);
    expect(s.spec!.negative).toContain("can tilting, tipping or lifting");
    expect(labelLockGaps(s)).toEqual([]);
    expect(applyLabelLock(s)).toBe(s); // idempotent
  });

  it("drops pouring clauses from the product framing", () => {
    const s = applyLabelLock(shot({ framing: "Can at 45% of frame height, real label square to camera and held steady while pouring. The glass fills the lower right." }));
    expect(s.spec!.productFraming).not.toMatch(/pouring/);
    expect(s.spec!.productFraming).toMatch(/^Can at 45% of frame height, The glass fills the lower right|^Can at 45% of frame height/);
  });

  it("keeps a still, non-pouring shot's camera move", () => {
    const s = applyLabelLock(shot({ visual: "The can sits on the table, label forward.", beats: ["0–1.2s hand sets the can down", "1.2–3s the can stays still"] }));
    expect(s.camera).toBe("slow push-in");
    expect(s.spec!.motionBeats).toEqual(["0–1.2s hand sets the can down", "1.2–3s the can stays still"]);
  });

  it("leaves the packshot alone", () => {
    const p = shot({ source: "packshot", beats: ["0–5s the camera orbits; the can turns slowly"] });
    expect(applyLabelLock(p)).toBe(p);
  });
});

describe("continuity locks", () => {
  it("locks the hero shot's glass and the label orientation on every generated shot", () => {
    const shots = [shot(), shot({ setting: "dinner table with a tall glass", visual: "The can, label forward, beside a tall glass." }), shot({ source: "packshot" })];
    expect(glassLock(shots)).toBe("ice-filled short tumbler");
    const out = continuityLocks(shots);
    expect(out[1].spec!.continuity![0]).toMatch(/same ice-filled short tumbler in every shot/);
    expect(out[1].spec!.continuity![1]).toMatch(/upright and square to camera/);
    expect(out[2].spec!.continuity).toBeUndefined();
    expect(specBlock(out[0])).toContain("Continuity: Glass: the same ice-filled short tumbler");
  });

  it("enforceShotRules applies both, and the edit judge asks about glass and label orientation", () => {
    const out = enforceShotRules([shot(), shot({ id: "s1" } as Partial<Shot>)]);
    expect(out.every((s) => s.spec!.continuity?.length === 2 && !s.spec!.motionBeats.some(movesProduct))).toBe(true);
    expect(CONTINUITY_LOCK_ASK).toMatch(/glass changes type, size or shape/);
    expect(CONTINUITY_LOCK_ASK).toMatch(/label's orientation/);
  });
});
