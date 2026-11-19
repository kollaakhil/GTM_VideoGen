import { describe, expect, it } from "vitest";
import { sheetGate, ruleIssues, claimIssues, confessionLoopChecks } from "@/lib/sheet/gate";
import type { ShotSheet, StyleRule } from "@/lib/shot-sheet";

const baseSheet = (): ShotSheet => ({
  version: 1,
  targetSec: 10,
  aspect: "16:9",
  fps: 24,
  audioMode: "vo",
  bed: "",
  palette: "",
  rules: [],
  shots: [
    { id: "s1", n: 1, start: 0, end: 3, shotType: "WS", framing: "wide shot", camera: { angle: "eye level", move: "slow push-in", lensMm: 50 }, subject: "product", action: "sits", lighting: "soft", text: null, audio: { vo: "Test product", sfx: null, music: null }, transition: "cut", engine: "blender", engineLocked: false, editorNote: "" },
    { id: "s2", n: 2, start: 3, end: 7, shotType: "CU", framing: "close-up", camera: { angle: "low", move: "static", lensMm: 85 }, subject: "detail", action: "gleams", lighting: "hard", text: null, audio: { vo: "Amazing features", sfx: null, music: null }, transition: "cut", engine: "ai_video", engineLocked: false, prompt: "product detail shot", editorNote: "" },
    { id: "s3", n: 3, start: 7, end: 10, shotType: "end card", framing: "flat", camera: { angle: "flat", move: "static", lensMm: 50 }, subject: "end card", action: "", lighting: "", text: null, audio: { vo: null, sfx: null, music: "bed resolves" }, transition: "fade_black", engine: "remotion", engineLocked: false, editorNote: "" },
  ],
  endCard: { title: "Product", line: "Get yours today", footer: "" },
});

describe("Gate severity tiers", () => {
  it("style rule violations are warnings, not blocking errors", () => {
    const sheet = baseSheet();
    const rules: StyleRule[] = [
      { id: "r1", text: "No wide reveal holds for at least four full seconds", check: "reveal_holds" },
    ];
    const issues = ruleIssues(sheet, rules);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every(i => i.level === "warn")).toBe(true);
    expect(issues[0].text).toMatch(/no wide reveal holds/);
  });

  it("claim errors remain blocking", () => {
    const sheet = baseSheet();
    sheet.shots[0].audio.vo = "3 million tokens";
    const facts = "1 million tokens";
    const issues = claimIssues(sheet, facts);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every(i => i.level === "error")).toBe(true);
    expect(issues[0].text).toMatch(/claims.*3million/);
  });

  it("confession loop pattern checks are warnings", () => {
    const sheet = baseSheet();
    sheet.patternId = "confession_loop";
    sheet.audioMode = "vo";
    sheet.shots[0].beat = "goal";
    const issues = confessionLoopChecks(sheet);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every(i => i.level === "warn")).toBe(true);
  });

  it("clock/timing errors remain blocking", () => {
    const sheet = baseSheet();
    sheet.shots[0].end = 99; // broken timing - way over targetSec
    sheet.shots[1].start = 99;
    sheet.shots[1].end = 100;
    sheet.shots[2].start = 100;
    sheet.shots[2].end = 200; // Total 200s vs targetSec 10s
    const gate = sheetGate(sheet, { facts: "" });
    expect(gate.pass).toBe(false);
    const timingErrors = gate.issues.filter(i => i.level === "error");
    expect(timingErrors.length).toBeGreaterThan(0);
  });

  it("missing required fields remain blocking", () => {
    const sheet = baseSheet();
    sheet.shots[0].camera.move = ""; // missing required field
    const gate = sheetGate(sheet, { facts: "" });
    expect(gate.pass).toBe(false);
    const fieldErrors = gate.issues.filter(i => i.level === "error" && /no complete camera/i.test(i.text));
    expect(fieldErrors.length).toBeGreaterThan(0);
  });

  it("gate passes with only warnings", () => {
    const sheet = baseSheet();
    const rules: StyleRule[] = [
      { id: "r1", text: "No wide reveal holds for at least four full seconds", check: "reveal_holds" },
    ];
    const gate = sheetGate(sheet, { facts: "Product with amazing features", rules });
    expect(gate.pass).toBe(true);
    const warnings = gate.issues.filter(i => i.level === "warn");
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("gate fails with blocking errors even if warnings present", () => {
    const sheet = baseSheet();
    sheet.shots[0].audio.vo = "5 million tokens";
    const rules: StyleRule[] = [
      { id: "r1", text: "Push-in camera move", check: "push_in" },
    ];
    const gate = sheetGate(sheet, { facts: "1 million tokens", rules });
    expect(gate.pass).toBe(false);
    const errors = gate.issues.filter(i => i.level === "error");
    const warnings = gate.issues.filter(i => i.level === "warn");
    expect(errors.length).toBeGreaterThan(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe("Gate override logic", () => {
  it("non-claim errors can be overridden", () => {
    const sheet = baseSheet();
    sheet.shots[0].audio = { vo: null, sfx: null, music: null }; // no sound
    const gate = sheetGate(sheet, { facts: "" });
    expect(gate.pass).toBe(false);
    const blockingErrors = gate.issues.filter(i => i.level === "error");
    const claimErrors = blockingErrors.filter(i => 
      i.text.includes("claims") || 
      i.text.includes("unverified") || 
      i.text.includes("facts mark as") ||
      i.text.includes("verified facts don't support")
    );
    expect(claimErrors.length).toBe(0);
  });

  it("claim errors cannot be overridden", () => {
    const sheet = baseSheet();
    sheet.shots[0].audio.vo = "10 million tokens";
    const gate = sheetGate(sheet, { facts: "1 million tokens" });
    expect(gate.pass).toBe(false);
    const blockingErrors = gate.issues.filter(i => i.level === "error");
    const claimErrors = blockingErrors.filter(i => 
      i.text.includes("claims") || 
      i.text.includes("unverified") || 
      i.text.includes("facts mark as") ||
      i.text.includes("verified facts don't support")
    );
    expect(claimErrors.length).toBeGreaterThan(0);
  });

  it("superlative without fact support is a claim error", () => {
    const sheet = baseSheet();
    sheet.shots[0].audio.vo = "The fastest AI ever";
    const facts = "An AI model";
    const issues = claimIssues(sheet, facts);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some(i => i.text.includes("fastest"))).toBe(true);
    expect(issues.every(i => i.level === "error")).toBe(true);
  });
});
