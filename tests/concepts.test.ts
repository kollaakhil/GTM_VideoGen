import { describe, expect, it } from "vitest";
import { diversityIssues, selectDiverse } from "../src/lib/concepts";
import type { Concept } from "../src/lib/types";

const c = (id: string, persona: string, angle: string, format: string, setting: string, hook: string): Concept => ({
  id, persona, angle, format, setting, hook, awareness: "problem", visualWorld: `${setting} light`, talent: persona, why: "",
});

describe("entity diversity gate", () => {
  it("picks three concepts that differ in persona, format and setting", () => {
    const list = [
      c("a", "Busy mom", "Time saved", "UGC testimonial", "kitchen", "I set this up in ten minutes"),
      c("b", "Busy mom", "Time saved", "UGC testimonial", "kitchen", "I set this up in ten minutes flat"),
      c("c", "First-time host", "Cost", "Before / after", "living room", "Decorator quoted me two grand"),
      c("d", "Grandparent", "Tradition", "Cinematic lifestyle", "temple courtyard", "The puja she remembers"),
    ];
    const picked = selectDiverse(list).filter((x) => x.selected);
    expect(picked).toHaveLength(3);
    expect(new Set(picked.map((x) => x.setting)).size).toBe(3);
    expect(picked.map((x) => x.id)).not.toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("flags near-duplicates", () => {
    const dupes = selectDiverse([c("a", "Mom", "Time", "UGC", "kitchen", "same hook here"), c("b", "Mom", "Time", "UGC", "kitchen", "same hook here")], 2);
    expect(diversityIssues(dupes.filter((x) => x.selected)).length).toBeGreaterThan(0);
  });
});
