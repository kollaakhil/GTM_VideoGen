import { describe, expect, it } from "vitest";
import { DEFAULT_NEGATIVE, lensMm, negativePrompt, specBlock, specGaps, toSpec } from "@/lib/shot-spec";
import { shotRules } from "@/lib/stage-gates";
import type { Shot } from "@/lib/types";

const full = { subject: "woman, 30s, red flannel", productFraming: "can fills lower third, label square to camera", lensMm: 50, cameraMove: "slow push-in", lighting: "warm window key from left", setting: "diner booth, chrome edge", motionBeats: ["0–2s she slides the can over", "2–4s condensation beads"], negative: ["second can"] };
const shot = (spec?: Shot["spec"]): Shot => ({ id: "s0", beat: "hook", seconds: 4, visual: "can on table", camera: "push-in", vo: "x", status: "planned", spec });

describe("shot specs", () => {
  it("reads lens mm from text or hints", () => {
    expect(lensMm("85mm portrait")).toBe(85);
    expect(lensMm("macro detail")).toBe(100);
    expect(lensMm("wide establishing")).toBe(24);
    expect(lensMm("handheld")).toBeNull();
  });
  it("coerces a loose planner spec and falls back to the camera line", () => {
    const s = toSpec({ subject: "x", lensMm: "35mm", motionBeats: ["a", "b", "c", "d", 3] }, { visual: "", camera: "orbit" });
    expect(s.lensMm).toBe(35);
    expect(s.cameraMove).toBe("orbit");
    expect(s.motionBeats).toEqual(["a", "b", "c"]);
    expect(toSpec(null, { visual: "", camera: "c" }).subject).toBe("");
  });
  it("flags missing parts and passes a full spec", () => {
    expect(specGaps(shot(full))).toEqual([]);
    expect(specGaps(shot())).toEqual(["s0: no structured spec"]);
    expect(specGaps(shot({ ...full, lensMm: 0, lighting: "" })).length).toBe(2);
  });
  it("builds a fixed-order block and a deduped negative prompt", () => {
    expect(specBlock(shot(full))).toMatch(/^Subject: .*Product: .*Setting: .*Light: .*Lens: 50mm\. Camera: slow push-in\. Motion: 0–2s .* → 2–4s/);
    const neg = negativePrompt(shot(full));
    expect(neg.startsWith("second can")).toBe(true);
    expect(neg).toContain(DEFAULT_NEGATIVE[1]);
  });
  it("the shot-plan gate scores structured specs", () => {
    const r = shotRules([shot(full), { ...shot(), id: "s1" }]).find((x) => x.name === "structured spec")!;
    expect(r.score).toBeLessThan(10);
    expect(r.note).toContain("s1");
  });
});
