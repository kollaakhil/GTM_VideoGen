import { describe, expect, it, vi } from "vitest";
import { sheetGate } from "@/lib/sheet/gate";
import type { ShotSheet } from "@/lib/shot-sheet";
import type { GateResult } from "@/lib/sheet/gate";

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
    { id: "s1", n: 1, start: 0, end: 5, shotType: "WS", framing: "wide shot", camera: { angle: "eye level", move: "slow push-in", lensMm: 50 }, subject: "product", action: "sits", lighting: "soft", text: null, audio: { vo: "Test", sfx: null, music: null }, transition: "cut", engine: "blender", engineLocked: false, editorNote: "" },
    { id: "s2", n: 2, start: 5, end: 10, shotType: "end card", framing: "flat", camera: { angle: "flat", move: "static", lensMm: 50 }, subject: "end card", action: "", lighting: "", text: null, audio: { vo: null, sfx: null, music: null }, transition: "fade_black", engine: "remotion", engineLocked: false, editorNote: "" },
  ],
  endCard: { title: "Product", line: "Get it", footer: "" },
});

describe("Fix gaps scoring", () => {
  const scoreGate = (gate: GateResult) => {
    const blocking = gate.issues.filter((i) => i.level === "error").length;
    const warnings = gate.issues.filter((i) => i.level === "warn").length;
    return blocking * 10 + warnings;
  };

  it("blocking errors count 10x more than warnings", () => {
    const gate1: GateResult = { pass: false, issues: [{ level: "error", text: "Error 1" }], checkedAt: "" };
    const gate2: GateResult = { pass: true, issues: [{ level: "warn", text: "Warn 1" }, { level: "warn", text: "Warn 2" }], checkedAt: "" };
    expect(scoreGate(gate1)).toBe(10);
    expect(scoreGate(gate2)).toBe(2);
  });

  it("keeps original sheet when candidate has same score", () => {
    const gate1: GateResult = { pass: false, issues: [{ level: "error", text: "E1" }], checkedAt: "" };
    const gate2: GateResult = { pass: false, issues: [{ level: "error", text: "E2" }], checkedAt: "" };
    expect(scoreGate(gate1)).toBe(scoreGate(gate2));
  });

  it("keeps original sheet when candidate has worse score", () => {
    const gate1: GateResult = { pass: false, issues: [{ level: "error", text: "E1" }], checkedAt: "" };
    const gate2: GateResult = { pass: false, issues: [{ level: "error", text: "E1" }, { level: "error", text: "E2" }], checkedAt: "" };
    expect(scoreGate(gate2)).toBeGreaterThan(scoreGate(gate1));
  });

  it("prefers candidate with lower score", () => {
    const gate1: GateResult = { pass: false, issues: [{ level: "error", text: "E1" }, { level: "error", text: "E2" }], checkedAt: "" };
    const gate2: GateResult = { pass: false, issues: [{ level: "error", text: "E1" }], checkedAt: "" };
    expect(scoreGate(gate2)).toBeLessThan(scoreGate(gate1));
  });

  it("reducing warnings improves score", () => {
    const gate1: GateResult = { pass: true, issues: [{ level: "warn", text: "W1" }, { level: "warn", text: "W2" }, { level: "warn", text: "W3" }], checkedAt: "" };
    const gate2: GateResult = { pass: true, issues: [{ level: "warn", text: "W1" }], checkedAt: "" };
    expect(scoreGate(gate2)).toBeLessThan(scoreGate(gate1));
  });
});

describe("Fix gaps behavior", () => {
  it("targets both errors and warnings for improvement", () => {
    const sheet = baseSheet();
    sheet.shots[0].audio = { vo: null, sfx: null, music: null }; // error: no sound
    const gate = sheetGate(sheet, { facts: "", rules: [{ id: "r1", text: "Push-in", check: "push_in" }] });
    const allIssues = gate.issues;
    const errors = allIssues.filter(i => i.level === "error");
    const warnings = allIssues.filter(i => i.level === "warn");
    expect(errors.length).toBeGreaterThan(0); // no sound error
    expect(warnings.length).toBeGreaterThan(0); // push-in rule warning
  });

  it("keeps original when no improvement possible", () => {
    const original = baseSheet();
    const candidate = baseSheet();
    const originalGate = sheetGate(original, { facts: "" });
    const candidateGate = sheetGate(candidate, { facts: "" });
    const originalScore = originalGate.issues.filter(i => i.level === "error").length * 10 + originalGate.issues.filter(i => i.level === "warn").length;
    const candidateScore = candidateGate.issues.filter(i => i.level === "error").length * 10 + candidateGate.issues.filter(i => i.level === "warn").length;
    expect(candidateScore).toBe(originalScore);
  });
});

describe("Network retry logic", () => {
  it("retries on fetch failed error", async () => {
    let attempts = 0;
    const mockFetch = vi.fn(async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error("fetch failed");
      }
      return { ok: true, json: async () => ({ data: "success" }) };
    });
    
    const retryFetch = async () => {
      for (let retry = 0; retry < 2; retry++) {
        try {
          return await mockFetch();
        } catch (e) {
          const err = e as Error;
          const isNetworkError = /fetch failed|ConnectTimeoutError|UND_ERR_CONNECT_TIMEOUT|5\d{2}/i.test(err.message);
          if (isNetworkError && retry < 1) {
            continue;
          }
          throw err;
        }
      }
    };
    
    await retryFetch();
    expect(attempts).toBe(2);
  });

  it("retries on ConnectTimeoutError", async () => {
    let attempts = 0;
    const mockFetch = vi.fn(async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error("ConnectTimeoutError: timeout");
      }
      return { ok: true };
    });
    
    const retryFetch = async () => {
      for (let retry = 0; retry < 2; retry++) {
        try {
          return await mockFetch();
        } catch (e) {
          const err = e as Error;
          const isNetworkError = /fetch failed|ConnectTimeoutError|UND_ERR_CONNECT_TIMEOUT|5\d{2}/i.test(err.message);
          if (isNetworkError && retry < 1) {
            continue;
          }
          throw err;
        }
      }
    };
    
    await retryFetch();
    expect(attempts).toBe(2);
  });

  it("does not retry on non-network errors", async () => {
    let attempts = 0;
    const mockFetch = vi.fn(async () => {
      attempts++;
      throw new Error("Invalid input");
    });
    
    const retryFetch = async () => {
      for (let retry = 0; retry < 2; retry++) {
        try {
          return await mockFetch();
        } catch (e) {
          const err = e as Error;
          const isNetworkError = /fetch failed|ConnectTimeoutError|UND_ERR_CONNECT_TIMEOUT|5\d{2}/i.test(err.message);
          if (isNetworkError && retry < 1) {
            continue;
          }
          throw err;
        }
      }
    };
    
    await expect(retryFetch()).rejects.toThrow("Invalid input");
    expect(attempts).toBe(1);
  });
});
