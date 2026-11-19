import { describe, expect, it } from "vitest";
import { sheetGate } from "@/lib/sheet/gate";
import type { ShotSheet } from "@/lib/shot-sheet";

const makeBaseSheet = (targetSec: number): ShotSheet => ({
  version: 1,
  targetSec,
  aspect: "16:9",
  fps: 24,
  audioMode: "vo",
  bed: "",
  palette: "",
  rules: [],
  endCard: { title: "Brand", line: "line", footer: "" },
  shots: [],
});

describe("gate threshold parsing", () => {
  it('parses "four full seconds" from rule text and requires 4s hold', () => {
    const sheet: ShotSheet = {
      ...makeBaseSheet(3.9),
      rules: [{ id: "reveal_holds", text: "Hold the contemplative stillness for at least four full seconds before any narrative text or major physical action unfolds.", check: "reveal_holds" }],
      shots: [
        { id: "s1", n: 1, start: 0, end: 3.9, shotType: "WS", framing: "wide reveal", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "scene", action: "holds", lighting: "soft", text: null, audio: { vo: null, sfx: "ambience", music: null }, transition: "cut", engine: "blender", engineLocked: false, editorNote: "" },
      ],
    };
    const result = sheetGate(sheet, { facts: "", rules: sheet.rules });
    expect(result.pass).toBe(true); // Style rules are warnings, not blocking errors
    expect(result.issues.some((i) => i.level === "warn" && i.text.includes("no wide reveal holds for 4 s or more"))).toBe(true);
  });

  it("passes when wide shot holds for exactly the threshold", () => {
    const sheet: ShotSheet = {
      ...makeBaseSheet(4),
      rules: [{ id: "reveal_holds", text: "Hold for at least four seconds.", check: "reveal_holds" }],
      shots: [
        { id: "s1", n: 1, start: 0, end: 4, shotType: "WS", framing: "wide reveal", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "scene", action: "holds", lighting: "soft", text: null, audio: { vo: null, sfx: "ambience", music: null }, transition: "cut", engine: "blender", engineLocked: false, editorNote: "" },
      ],
    };
    const result = sheetGate(sheet, { facts: "", rules: sheet.rules });
    expect(result.pass).toBe(true);
  });

  it("accepts various shot type/framing words: wide, reveal, establishing, full, long shot, extreme wide, WS, EWS", () => {
    const testCases = [
      "wide reveal",
      "establishing shot",
      "full scene",
      "long shot",
      "extreme wide",
      "WS",
      "EWS",
    ];

    for (const framing of testCases) {
      const sheet: ShotSheet = {
        ...makeBaseSheet(3.5),
        rules: [{ id: "reveal_holds", text: "Hold for at least 3 seconds.", check: "reveal_holds" }],
        shots: [
          { id: "s1", n: 1, start: 0, end: 3.5, shotType: framing.includes("WS") || framing.includes("EWS") ? framing : "WS", framing: framing, camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "scene", action: "holds", lighting: "soft", text: null, audio: { vo: null, sfx: "ambience", music: null }, transition: "cut", engine: "blender", engineLocked: false, editorNote: "" },
        ],
      };
      const result = sheetGate(sheet, { facts: "", rules: sheet.rules });
      expect(result.pass).toBe(true); // Should pass for "${framing}"
    }
  });

  it("parses numeric thresholds from rule text", () => {
    const sheet: ShotSheet = {
      ...makeBaseSheet(4.9),
      rules: [{ id: "reveal_holds", text: "Hold for at least 5 seconds.", check: "reveal_holds" }],
      shots: [
        { id: "s1", n: 1, start: 0, end: 4.9, shotType: "WS", framing: "wide", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "scene", action: "holds", lighting: "soft", text: null, audio: { vo: null, sfx: null, music: null }, transition: "cut", engine: "blender", engineLocked: false, editorNote: "" },
      ],
    };
    const result = sheetGate(sheet, { facts: "", rules: sheet.rules });
    expect(result.pass).toBe(true); // Style rules are warnings
    expect(result.issues.some((i) => i.level === "warn" && i.text.includes("no wide reveal holds for 5 s or more"))).toBe(true);
  });

  it("defaults to 3s when no threshold is in the rule text", () => {
    const sheet: ShotSheet = {
      ...makeBaseSheet(2.9),
      rules: [{ id: "reveal_holds", text: "Hold the reveal", check: "reveal_holds" }],
      shots: [
        { id: "s1", n: 1, start: 0, end: 2.9, shotType: "WS", framing: "wide", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "scene", action: "holds", lighting: "soft", text: null, audio: { vo: null, sfx: null, music: null }, transition: "cut", engine: "blender", engineLocked: false, editorNote: "" },
      ],
    };
    const result = sheetGate(sheet, { facts: "", rules: sheet.rules });
    expect(result.pass).toBe(true); // Style rules are warnings
    expect(result.issues.some((i) => i.level === "warn" && i.text.includes("no wide reveal holds for 3 s or more"))).toBe(true);
  });

  it("recognizes word-form numbers: one through ten", () => {
    const words = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const expected = i + 1;
      const dur = expected - 0.1;
      const sheet: ShotSheet = {
        ...makeBaseSheet(dur),
        rules: [{ id: "reveal_holds", text: `Hold for ${word} seconds`, check: "reveal_holds" }],
        shots: [
          { id: "s1", n: 1, start: 0, end: dur, shotType: "WS", framing: "wide", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "scene", action: "holds", lighting: "soft", text: null, audio: { vo: null, sfx: null, music: null }, transition: "cut", engine: "blender", engineLocked: false, editorNote: "" },
        ],
      };
      const result = sheetGate(sheet, { facts: "", rules: sheet.rules });
      expect(result.pass).toBe(true); // Style rules are warnings
      expect(result.issues.some((i) => i.level === "warn" && i.text.includes(`no wide reveal holds for ${expected} s or more`))).toBe(true);
    }
  });
});
