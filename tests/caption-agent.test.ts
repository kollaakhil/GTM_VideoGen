import { describe, expect, it } from "vitest";
import { captionMode, collision, keywordCues, keywordPhrase, mapSubject, placeCaptions } from "@/lib/caption-agent";
import { boxAt, CAPTION_SLOTS, type Box, textBox } from "@/lib/caption-layout";
import { expectedCopy, timedCues } from "@/lib/video-post";

const LINES = ["Love cola, dread the sugar guilt?", "Keep the cola, swap in OLIPOP.", "Your favorite cola, made merry, with just fifty calories.", "Half off two-plus cases. Shop at drinkolipop.com."];
const W = 486, H = 864, SIZE = 30;
const boxFor = (text: string, y: number) => boxAt(y, textBox(text, SIZE, W, H));

describe("caption mode", () => {
  it("defaults to keywords and accepts off/full", () => {
    expect(captionMode(undefined)).toBe("keywords");
    expect(captionMode("off")).toBe("off");
    expect(captionMode("full")).toBe("full");
    expect(captionMode("loud")).toBe("keywords");
  });
  it("off draws no captions or overlays; only the end card is expected", () => {
    const segs = [{ start: 0, end: 3, text: LINES[0], onScreen: "Classic cola ritual." }, { start: 3, end: 7, text: LINES[1] }];
    expect(timedCues(segs, 4, "off")).toEqual([]);
    const copy = expectedCopy(segs, { brand: "OLIPOP", line: "50% off 2+ cases", cta: "Shop at drinkolipop.com" }, 7, "off");
    expect(copy.every((c) => c.layer === "end")).toBe(true);
    expect(copy.length).toBeGreaterThan(0);
  });
});

describe("keyword captions", () => {
  it("keeps one 2-4 word phrase per line, favouring numbers and the brand", () => {
    const k = LINES.map((l) => keywordPhrase(l, "OLIPOP").text);
    for (const t of k) expect(t.split(/\s+/).length).toBeGreaterThanOrEqual(2), expect(t.split(/\s+/).length).toBeLessThanOrEqual(4);
    expect(k[0]).not.toMatch(/,/); // never spans a comma ("Love cola, dread")
    expect(k[1]).toMatch(/OLIPOP/);
    expect(k[2]).toMatch(/fifty calories/);
    expect(k[3]).toMatch(/two-plus cases|drinkolipop\.com/);
    expect(k.join(" | ")).not.toMatch(/(^| )(the|at|in)( \||$)/); // never ends on a function word
  });
  it("shows the phrase from when it is said to the end of the line, at least 1.2 s", () => {
    const [c] = keywordCues([{ start: 3, end: 7, text: LINES[1], speech: { start: 3.15, end: 5.7 } }], "OLIPOP");
    expect(c.start).toBeGreaterThan(3.15);
    expect(c.end).toBeCloseTo(5.7, 5);
    expect(c.end - c.start).toBeGreaterThanOrEqual(1.2 - 1e-9);
  });
});

/** Subject boxes as the vision locator returns them: one per sampled frame. */
const at = (ts: number[], box: Box) => ts.map((t) => ({ t, box }));

describe("CTA keyword cue", () => {
  it("shows the approved on-screen CTA when it repeats the line, instead of a keyword pick", () => {
    const [c] = keywordCues([{ start: 11, end: 16, text: LINES[3], onScreen: "Shop at drinkolipop.com", speech: { start: 11.15, end: 15.6 } }], "OLIPOP");
    expect(c.text).toBe("Shop at drinkolipop.com");
    expect(c.start).toBeGreaterThanOrEqual(11);
  });
});

describe("caption placement agent", () => {
  it("ignores subject frames from the previous shot", () => {
    const subjects = at([10.6], { x: 0, y: 0, w: 1, h: 1 });
    const box = boxFor("Shop at drinkolipop.com", CAPTION_SLOTS[0]);
    expect(collision(box, 10.8, 16, subjects, [])).toBeNull();
  });
  it("maps subject boxes into padded and cropped aspects", () => {
    const b = { x: 0.25, y: 0.5, w: 0.5, h: 0.25 };
    const pad = mapSubject(b, { w: 486, h: 864 }, { w: 864, h: 864 }, "pad");
    expect(pad.y).toBeCloseTo(0.5, 5);
    expect(pad.h).toBeCloseTo(0.25, 5);
    expect(pad.x).toBeCloseTo((0.25 * 486 + (864 - 486) / 2) / 864, 5);
    expect(mapSubject(b, { w: 486, h: 864 }, { w: 486, h: 864 }, "crop")).toEqual(b);
  });
  it("moves a cue that covers the product in one sampled frame only", () => {
    // Product enters the lower third at 1.75 s; the cue spans 0-3 s in the default lower slot.
    const subjects = [...at([0.25, 0.75, 1.25], { x: 0.3, y: 0.3, w: 0.4, h: 0.25 }), ...at([1.75, 2.25, 2.75], { x: 0.2, y: 0.62, w: 0.6, h: 0.2 })];
    const cue = { start: 0, end: 3, text: "swap in OLIPOP", y: CAPTION_SLOTS[0], box: boxFor("swap in OLIPOP", CAPTION_SLOTS[0]) };
    expect(collision(cue.box, cue.start, cue.end, subjects, [])).toMatch(/covers the subject at 1\.8s/);
    const r = placeCaptions([cue], [], subjects, boxFor);
    expect(r.log[0].action).toBe("moved");
    expect(collision(r.captions[0].box, 0, 3, subjects, [])).toBeNull();
  });
  it("moves a cue off an overlay that is on screen at the same time", () => {
    const ov = { start: 0, end: 4, box: boxFor("Classic cola ritual. 5g sugar.", CAPTION_SLOTS[0]) };
    const cue = { start: 1, end: 3, text: "dread sugar guilt", y: CAPTION_SLOTS[0], box: boxFor("dread sugar guilt", CAPTION_SLOTS[0]) };
    const r = placeCaptions([cue], [ov], [], boxFor);
    expect(r.log[0].action).toBe("moved");
    expect(r.captions[0].y).not.toBe(CAPTION_SLOTS[0]);
  });
  it("never drops required copy; places it where it covers the least of the subject", () => {
    const subjects = [...at([0.25, 0.75], { x: 0.1, y: 0, w: 0.8, h: 0.6 }), ...at([1.25], { x: 0.1, y: 0.55, w: 0.8, h: 0.45 })];
    const hook = "Love cola, dread the sugar guilt?";
    const cue = { start: 0, end: 1.5, text: hook, y: CAPTION_SLOTS[0], box: boxFor(hook, CAPTION_SLOTS[0]), required: true };
    const r = placeCaptions([cue], [], subjects, boxFor);
    expect(r.captions).toHaveLength(1);
    expect(r.captions[0].text).toBe(hook);
    expect(r.log[0].action).toBe("least-overlap");
  });
  it("drops a cue when the subject fills every slot", () => {
    const subjects = at([0.25, 0.75, 1.25, 1.75], { x: 0.1, y: 0, w: 0.8, h: 1 });
    const cue = { start: 0, end: 2, text: "just fifty calories", y: CAPTION_SLOTS[0], box: boxFor("just fifty calories", CAPTION_SLOTS[0]) };
    const r = placeCaptions([cue], [], subjects, boxFor);
    expect(r.captions).toHaveLength(0);
    expect(r.log[0]).toMatchObject({ action: "dropped" });
  });
  it("shrinks a wide cue that collides with a subject at the side in every slot", () => {
    const subjects = [{ t: 0.5, box: { x: 0.62, y: 0, w: 0.38, h: 1 } }];
    const wide = "Half off two-plus cases";
    const cue = { start: 0, end: 1, text: wide, y: CAPTION_SLOTS[0], box: boxFor(wide, CAPTION_SLOTS[0]) };
    expect(collision(cue.box, 0, 1, subjects, [])).not.toBeNull();
    const r = placeCaptions([cue], [], subjects, boxFor);
    expect(r.log[0].action).toBe("shrunk");
    expect(r.captions[0].text.split(" ").length).toBeLessThan(4);
    expect(collision(r.captions[0].box, 0, 1, subjects, [])).toBeNull();
  });

});

describe("required copy prefers covering hands over the product label", () => {
  it("moves the hook off the package even when the subject box spans the frame", () => {
    const subject = { x: 0, y: 0.05, w: 1, h: 0.85 };   // hand + pour + can + glass
    const product = { x: 0.1, y: 0.45, w: 0.4, h: 0.4 }; // the labelled can, lower half
    const boxFor = (_t: string, y: number): Box => ({ x: 0.1, y: y - 0.04, w: 0.8, h: 0.08 });
    const cap = { start: 0, end: 2, text: "Love cola, dread the sugar guilt?", y: 0.74, box: boxFor("", 0.74), required: true };
    const { captions, log } = placeCaptions([cap], [], [{ t: 0.5, box: subject, product }, { t: 1.5, box: subject, product }], boxFor, [0.74, 0.66, 0.56, 0.36, 0.26, 0.17]);
    expect(log[0].action).toBe("least-overlap");
    expect(captions[0].y).toBeLessThan(0.4);
  });
});
