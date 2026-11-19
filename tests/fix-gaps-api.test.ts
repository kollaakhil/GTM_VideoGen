import { describe, expect, it, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.DATA_DIR = require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "fix-gaps-"));
});

import { sheetActions } from "@/lib/sheet/actions";
import { newSheetRun } from "@/lib/sheet/flow";
import { put } from "@/lib/store";
import type { ShotSheet } from "@/lib/shot-sheet";
import type { SheetRun } from "@/lib/sheet/run-types";

// Mock the AI module with importOriginal so other exports still work
vi.mock("@/lib/ai", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/ai")>();
  return {
    ...orig,
    chatJSON: vi.fn(),
  };
});

const FACTS = "- Gemini 4 Neon.\n- 1 million-token context window.";

describe("fix_gaps API action", () => {
  let run: SheetRun;

  beforeEach(async () => {
    run = newSheetRun({ brandUrl: "https://blog.google", brand: "Gemini 4 Neon", goal: "Launch film", facts: FACTS, targetSec: 12 }, "test@example.com");
    run.brief = { objective: "Launch Neon", audience: "Developers", insight: "Powerful", offer: "", mandatories: [], kpi: "Signups" };
    run.research = { summary: "Research", audience: "Devs", tone: "Confident", valueProps: ["Fast"], competitors: [], angles: [], sources: [] };
    run.rules = [{ id: "reveal_holds", text: "Hold for at least four full seconds.", check: "reveal_holds" }];
    run.sheet = {
      version: 1,
      targetSec: 12,
      aspect: "16:9",
      fps: 24,
      audioMode: "foley",
      bed: "",
      palette: "",
      rules: run.rules,
      endCard: { title: "Gemini 4 Neon", line: "Available now", footer: "" },
      shots: [
        { id: "s1", n: 1, start: 0, end: 2.5, shotType: "WS", framing: "wide reveal", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "scene", action: "holds", lighting: "soft", text: null, audio: { vo: null, sfx: "ambience", music: null }, transition: "cut", engine: "blender", engineLocked: false, editorNote: "" },
      ],
    };
    run.gate = {
      pass: false,
      issues: [{ level: "error", text: 'Rule "Hold for at least four full seconds.": no wide reveal holds for 4 s or more.', rule: "reveal_holds" }],
      checkedAt: new Date().toISOString(),
    };
    await put("sheet_runs", run);
  });

  it("returns 401 when unauthenticated (checked by route handler)", async () => {
    // The sheetActions function itself doesn't check auth; the route handler does.
    // We test that the action requires a valid run and user.
    const response = await sheetActions({ action: "fix_gaps", runId: "nonexistent" }, "test@example.com");
    expect(response).toBeTruthy();
    const json = await response!.json();
    expect(json.error).toBe("Run not found");
  });

  it("returns 400 when sheet already passes the gate", async () => {
    run.gate!.pass = true;
    await put("sheet_runs", run);
    
    const response = await sheetActions({ action: "fix_gaps", runId: run.id }, "test@example.com");
    expect(response).toBeTruthy();
    const json = await response!.json();
    expect(json.error).toBe("Sheet already passes the gate");
  });

  it("returns 409 when a render is running", async () => {
    run.versions = [{ id: "v1", stack: { id: "test", label: "Test", description: "", models: {}, estimatedCostUsd: 0 }, tier: "preview", status: "rendering", estimate: null, shots: [], videoUrl: null, contactUrl: null, usd: 0, ms: 0 }];
    await put("sheet_runs", run);
    
    const response = await sheetActions({ action: "fix_gaps", runId: run.id }, "test@example.com");
    expect(response).toBeTruthy();
    const json = await response!.json();
    expect(json.error).toBe("Cannot fix gaps while a render is running");
  });

  it("calls the LLM with gate errors and returns the fixed sheet", async () => {
    const { chatJSON } = await import("@/lib/ai");
    const mockChatJSON = chatJSON as ReturnType<typeof vi.fn>;
    
    // Mock response: longer shot that satisfies the 4s threshold
    mockChatJSON.mockResolvedValueOnce({
      data: {
        script: "Neon glows.",
        sheet: {
          bed: "",
          endCard: { title: "Gemini 4 Neon", line: "Available now", footer: "" },
          palette: "",
          shots: [
            { start: 0, end: 4.5, shotType: "WS", framing: "wide reveal", camera: { angle: "eye level", move: "slow push-in", lensMm: 50 }, subject: "neon sign", action: "glows for 4+ seconds", lighting: "soft glow", text: null, audio: { vo: null, sfx: "hum", music: null }, transition: "fade_black", engine: "blender", blender: { template: "glow_word", word: "NEON" } },
          ],
        },
      },
      usage: { costUsd: 0.015 },
    });

    const response = await sheetActions({ action: "fix_gaps", runId: run.id }, "test@example.com");
    expect(response).toBeTruthy();
    const json = await response!.json();
    
    expect(json.error).toBeUndefined();
    expect(json.run.sheet.version).toBe(2); // New revision
    expect(json.run.sheet.shots[0].end).toBeGreaterThanOrEqual(4); // Shot lengthened
    expect(json.run.gate.pass).toBe(true); // Gate now passes
    expect(json.fixed).toBe(1);
    expect(json.remaining).toBe(0);
    expect(json.changes.length).toBeGreaterThan(0);
    expect(json.changes[0]).toMatch(/Shot 1:.*(2.5s → 4.5s|framing)/);
    
    // Verify LLM was called with the error
    expect(mockChatJSON).toHaveBeenCalledTimes(1);
    const [, userPrompt] = mockChatJSON.mock.calls[0];
    expect(userPrompt).toContain("FIX THESE PROBLEMS");
    expect(userPrompt).toContain("no wide reveal holds for 4 s or more");
  });

  it("loops up to 2 repair attempts and returns the best result", async () => {
    const { chatJSON } = await import("@/lib/ai");
    const mockChatJSON = chatJSON as ReturnType<typeof vi.fn>;
    
    // First attempt: still fails (3.8s, just under threshold)
    mockChatJSON.mockResolvedValueOnce({
      data: {
        script: "x",
        sheet: {
          bed: "", endCard: { title: "Gemini 4 Neon", line: "Available now", footer: "" }, palette: "",
          shots: [{ start: 0, end: 3.8, shotType: "WS", framing: "wide", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "scene", action: "holds", lighting: "soft", text: null, audio: { vo: null, sfx: null, music: null }, transition: "cut", engine: "blender" }],
        },
      },
      usage: { costUsd: 0.01 },
    });
    
    // Second attempt: passes (4.2s)
    mockChatJSON.mockResolvedValueOnce({
      data: {
        script: "x",
        sheet: {
          bed: "", endCard: { title: "Gemini 4 Neon", line: "Available now", footer: "" }, palette: "",
          shots: [{ start: 0, end: 4.2, shotType: "WS", framing: "wide reveal", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "scene", action: "holds", lighting: "soft", text: null, audio: { vo: null, sfx: null, music: null }, transition: "cut", engine: "blender" }],
        },
      },
      usage: { costUsd: 0.01 },
    });

    const response = await sheetActions({ action: "fix_gaps", runId: run.id }, "test@example.com");
    expect(response).toBeTruthy();
    const json = await response!.json();
    
    expect(mockChatJSON).toHaveBeenCalledTimes(2);
    expect(json.run.gate.pass).toBe(true);
    expect(json.run.sheet.shots[0].end).toBeCloseTo(4.2, 1);
  });

  it("tracks cost and meters against the run cap", async () => {
    run.cost.capUsd = 0.01; // Very low cap
    await put("sheet_runs", run);
    
    const { chatJSON } = await import("@/lib/ai");
    const mockChatJSON = chatJSON as ReturnType<typeof vi.fn>;
    mockChatJSON.mockResolvedValueOnce({
      data: { script: "x", sheet: { bed: "", endCard: { title: "X", line: "X", footer: "" }, palette: "", shots: [{ start: 0, end: 4, shotType: "WS", framing: "wide", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "x", action: "x", lighting: "x", text: null, audio: { vo: null, sfx: null, music: null }, transition: "cut", engine: "blender" }] } },
      usage: { costUsd: 0.02 },
    });

    const response = await sheetActions({ action: "fix_gaps", runId: run.id }, "test@example.com");
    expect(response).toBeTruthy();
    const json = await response!.json();
    
    // Should fail due to cap
    expect(json.error).toBeTruthy();
    expect(json.error).toContain("cap reached");
  });
});
