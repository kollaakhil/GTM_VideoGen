import { describe, expect, it } from "vitest";
import { canonExpected, canonHeard, sameCanon } from "@/lib/speech-canon";
import { alignWords, captionSync } from "@/lib/caption-sync";

const SCRIPT = "Love cola, dread the sugar guilt? Keep the cola, swap in OLIPOP. Your favorite cola, made merry, with just fifty calories. Half off two-plus cases. Shop at drinkolipop.com.";

describe("speech canon (final QA)", () => {
  it("maps ASR spellings of numbers and the brand to the script's words", () => {
    expect(sameCanon("Half off 2+ cases, shop at drinkaliepop.com.", "Half off two-plus cases. Shop at drinkolipop.com.", "OLIPOP")).toBe(true);
    expect(sameCanon("Keep the cola swap in ollie pop.", "Keep the cola, swap in OLIPOP.", "OLIPOP")).toBe(true);
    expect(sameCanon("with just 50 calories", "with just fifty calories", "OLIPOP")).toBe(true);
  });
  it("still fails real mis-speech", () => {
    expect(sameCanon("Keep the soda, swap in OLIPOP.", "Keep the cola, swap in OLIPOP.", "OLIPOP")).toBe(false);
    expect(sameCanon("Keep the cola, swap in Pepsi.", "Keep the cola, swap in OLIPOP.", "OLIPOP")).toBe(false);
    expect(sameCanon("Keep the cola swap in ollie pop.", "Keep the cola, swap in OLIPOP.")).toBe(false); // no brand: no merge
  });
  it("take 1 transcript is nearly the script once canonicalised", () => {
    const heard = "Love cola? Dred the sugar gilt? Keep the cola swapin' ollie pop. Your favorite cola made merry with just 50 calories? Half off two plus cases, shop at drinkaliepop.com.";
    const h = canonHeard(heard, SCRIPT, "OLIPOP").split(" "), e = canonExpected(SCRIPT).split(" ");
    const { missing } = alignWords(e, h);
    expect(missing).toEqual(["dread", "guilt", "swap", "in"]); // genuine ASR differences stay; numbers and brand no longer count
  });
  it("caption sync merges a split brand", () => {
    const words = [{ word: "swap", start: 4.9, end: 5.1 }, { word: "in", start: 5.1, end: 5.2 }, { word: "ollie", start: 5.2, end: 5.5 }, { word: "pop.", start: 5.5, end: 5.8 }];
    const [c] = captionSync([{ start: 4.8, end: 6.8, text: "swap in OLIPOP." }], words, 0.35, "OLIPOP");
    expect(c.coverage).toBe(1);
  });
});

describe("canon keeps the word before a brand term (13.32)", () => {
  it("does not merge 'at' into drinkolipop", () => {
    const exp = "Half off two-plus cases. Shop at drinkolipop.com.";
    expect(canonHeard("Half off 2+ cases. Shop at drinkolipop.com", exp, "OLIPOP")).toBe(canonExpected(exp));
    expect(sameCanon("Keep the cola. Swap in Olypop.", "Keep the cola, swap in OLIPOP.", "OLIPOP")).toBe(true);
    expect(sameCanon("Shop at drink olipop dot com", "Shop at drinkolipop.com", "OLIPOP")).toBe(true);
  });
});
