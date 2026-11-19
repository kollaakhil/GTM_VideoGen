import { describe, expect, it } from "vitest";
import { motionGraphicsEnabled, overlayKind } from "@/lib/motion-graphics";

describe("Remotion motion graphics", () => {
  it("offers and prices become tags; other lines are callouts", () => {
    expect(overlayKind("50% off 2+ cases, ends 11/30")).toBe("tag");
    expect(overlayKind("Free shipping $50+")).toBe("tag");
    expect(overlayKind("9g fiber, 5g sugar, 50 calories")).toBe("callout");
    expect(overlayKind("Classic cola, prebiotic twist")).toBe("callout");
  });
  it("is off under vitest unless forced, so unit tests never launch Chrome", () => {
    const prev = process.env.MOTION_GRAPHICS;
    delete process.env.MOTION_GRAPHICS;
    expect(motionGraphicsEnabled()).toBe(false);
    process.env.MOTION_GRAPHICS = "1";
    expect(motionGraphicsEnabled()).toBe(true);
    if (prev === undefined) delete process.env.MOTION_GRAPHICS; else process.env.MOTION_GRAPHICS = prev;
  });
});
