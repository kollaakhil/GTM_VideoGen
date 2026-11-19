import { describe, expect, it } from "vitest";
import { creativeBrief, endCardItems } from "@/lib/brief-policy";
import { expectedCopy } from "@/lib/video-post";

const brief = { objective: "o", audience: "a", insight: "i", offer: "50% off", kpi: "cost per purchase", mandatories: [
  "Open on a can cracking and a fizzing pour close-up", "End card: 50% off 2+ cases, ends 11/30", "Footer badge: Free shipping $50+ | 45-Day Money-Back Guarantee",
] } as never;

describe("end-card mandatories go to post, not the script", () => {
  it("moves end-card and footer items out of the writer's mandatories", () => {
    expect(endCardItems(brief)).toEqual(["50% off 2+ cases, ends 11/30", "Free shipping $50+ | 45-Day Money-Back Guarantee"]);
    const c = creativeBrief(brief);
    expect(c.mandatories).toEqual(["Open on a can cracking and a fizzing pour close-up"]);
    expect(c.endCard).toHaveLength(2);
  });
  it("the typeset end card carries the offer line and footer, and OCR expects both", () => {
    const cues = expectedCopy([], { brand: "OLIPOP", line: "50% off 2+ cases, ends 11/30", cta: "Shop at drinkolipop.com", footer: "Free shipping $50+" }, 10);
    expect(cues.filter((c) => c.layer === "end").map((c) => c.position)).toEqual(["brand", "line", "cta", "footer"]);
  });
});
