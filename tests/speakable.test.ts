import { describe, expect, it } from "vitest";
import { speakable } from "@/lib/ai";

describe("speakable", () => {
  it("reads all-caps brand words as one word and keeps acronyms", () => {
    expect(speakable("Keep the cola, swap in OLIPOP.")).toBe("Keep the cola, swap in Olipop.");
    expect(speakable("FREE shipping in the USA")).toBe("FREE shipping in the USA");
    expect(speakable("Shop at drinkolipop.com")).toBe("Shop at drinkolipop.com");
  });
});

it("speakable uses the researched pronunciation for the brand", () => {
  expect(speakable("Keep the cola, swap in OLIPOP.", { brand: "OLIPOP", pronunciation: "Ollie-pop" })).toBe("Keep the cola, swap in Ollie-pop.");
  expect(speakable("Visit drinkolipop.com", { brand: "OLIPOP", pronunciation: "Ollie-pop" })).toBe("Visit drinkolipop.com");
  expect(speakable("Try OLIPOP", { brand: "OLIPOP", pronunciation: "olipop" })).toBe("Try Olipop");
});
