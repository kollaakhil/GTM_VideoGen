import { describe, expect, it } from "vitest";
import { brandRules } from "@/lib/brand-rules";
import { creativeScore } from "@/lib/learnings";
import type { Brand, Creative } from "@/lib/types";

const base = { id: "c", runId: "r", title: "t", hook: "h", angle: "a", format: "static", mediaUrl: "", mediaType: "image", model: "m", qa: null, diversity: null, status: "draft", channel: null, metrics: null, costUsd: 0, createdAt: "" } as Creative;

describe("learning loop", () => {
  it("rewards approvals, QA passes and results; penalizes explicit rejections only", () => {
    expect(creativeScore({ ...base, status: "approved", qa: { score: 8, pass: true, notes: [] } as Creative["qa"] })).toBe(3);
    expect(creativeScore({ ...base, status: "rejected" })).toBe(0);
    expect(creativeScore({ ...base, status: "rejected", feedback: { decision: "reject", by: "u", at: "" } })).toBe(-3);
    expect(creativeScore({ ...base, status: "live", metrics: { roas: 2.5 } as unknown as Creative["metrics"] })).toBe(4.5);
  });
});

describe("brandRules", () => {
  it("turns the kit into mandatory prompt rules", () => {
    const b = { id: "b", name: "Acme", url: "https://acme.com", voice: "dry wit", audience: "", colors: [], createdAt: "", dos: ["show it in use"], donts: ["no discounts"], toneExamples: ["Built to last."] } as Brand;
    const r = brandRules(b);
    expect(r).toContain("Voice: dry wit");
    expect(r).toContain("Never: no discounts");
    expect(r).toContain('"Built to last."');
    expect(brandRules(null)).toBe("");
  });
});
