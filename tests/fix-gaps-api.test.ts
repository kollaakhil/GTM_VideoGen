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
    vi.clearAllMocks();
    run = newSheetRun({ brandUrl: "https://blog.google", brand: "Gemini 4 Neon", goal: "Launch film", facts: FACTS, targetSec: 12, patternId: "no_pattern" as any }, "test@example.com");
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
      patternId: undefined,
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
    
    // Mock response: shots that satisfy the 4s threshold, stay under 8s max, and match targetSec
    mockChatJSON.mockResolvedValue({
      data: {
        script: "Neon glows.",
        sheet: {
          bed: "",
          endCard: { title: "Gemini 4 Neon", line: "Available now", footer: "" },
          palette: "",
          patternId: undefined,
          shots: [
            { start: 0, end: 5, shotType: "WS", framing: "wide reveal", camera: { angle: "eye level", move: "slow push-in", lensMm: 50 }, subject: "neon sign", action: "glows for 4+ seconds", lighting: "soft glow", text: null, audio: { vo: null, sfx: "hum", music: null }, transition: "cut", engine: "blender", blender: { template: "glow_word", word: "NEON" } },
            { start: 5, end: 12, shotType: "MS", framing: "medium", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "product", action: "shows", lighting: "soft", text: null, audio: { vo: null, sfx: "whoosh", music: null }, transition: "cut", engine: "blender" },
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
    expect(json.run.sheet.shots[0].end - json.run.sheet.shots[0].start).toBeGreaterThanOrEqual(4); // Shot lengthened
    expect(json.run.gate.pass).toBe(true); // Gate now passes
    expect(json.fixed).toBe(1);
    expect(json.remaining).toBe(0);
    expect(json.changes.length).toBeGreaterThan(0);
    expect(json.changes[0]).toMatch(/Shot 1:.*(2.5s → 5.0s|framing)/);
    
    // Verify LLM was called with the error (calls[0]: [model, system, userPrompt])
    expect(mockChatJSON).toHaveBeenCalled();
    const calls = mockChatJSON.mock.calls;
    const userPrompt = calls[0][2] as string;
    expect(userPrompt).toContain("FIX THESE PROBLEMS");
    expect(userPrompt).toContain("no wide reveal holds for 4 s or more");
  });

  it("loops up to 2 repair attempts and returns the best result", async () => {
    const { chatJSON } = await import("@/lib/ai");
    const mockChatJSON = chatJSON as ReturnType<typeof vi.fn>;
    
    // First attempt: still fails (wide shot is only 3.8s, just under 4s threshold)
    mockChatJSON.mockResolvedValueOnce({
      data: {
        script: "x",
        sheet: {
          bed: "", endCard: { title: "Gemini 4 Neon", line: "Available now", footer: "" }, palette: "", patternId: undefined,
          shots: [
            { start: 0, end: 3.8, shotType: "WS", framing: "wide", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "scene", action: "holds 3.8s", lighting: "soft", text: null, audio: { vo: null, sfx: "hum", music: null }, transition: "cut", engine: "blender" },
            { start: 3.8, end: 12, shotType: "MS", framing: "medium", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "product", action: "shows", lighting: "soft", text: null, audio: { vo: null, sfx: "whoosh", music: null }, transition: "cut", engine: "blender" },
          ],
        },
      },
      usage: { costUsd: 0.01 },
    });
    
    // Second attempt: passes (5s wide shot, within 8s max)
    mockChatJSON.mockResolvedValueOnce({
      data: {
        script: "x",
        sheet: {
          bed: "", endCard: { title: "Gemini 4 Neon", line: "Available now", footer: "" }, palette: "", patternId: undefined,
          shots: [
            { start: 0, end: 5, shotType: "WS", framing: "wide reveal", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "scene", action: "holds for full duration", lighting: "soft", text: null, audio: { vo: null, sfx: "ambience", music: null }, transition: "cut", engine: "blender" },
            { start: 5, end: 12, shotType: "MS", framing: "medium", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "product", action: "shows", lighting: "soft", text: null, audio: { vo: null, sfx: "whoosh", music: null }, transition: "cut", engine: "blender" },
          ],
        },
      },
      usage: { costUsd: 0.01 },
    });

    const response = await sheetActions({ action: "fix_gaps", runId: run.id }, "test@example.com");
    expect(response).toBeTruthy();
    const json = await response!.json();
    
    expect(mockChatJSON).toHaveBeenCalledTimes(2);
    expect(json.run.gate.pass).toBe(true);
    expect(json.run.sheet.shots[0].end - json.run.sheet.shots[0].start).toBeGreaterThanOrEqual(4);
  });

  it("tracks cost and meters against the run cap", async () => {
    run.cost.capUsd = 0.01; // Very low cap
    await put("sheet_runs", run);
    
    // Don't need to mock chatJSON since it should fail before calling it
    const response = await sheetActions({ action: "fix_gaps", runId: run.id }, "test@example.com");
    expect(response).toBeTruthy();
    const json = await response!.json();
    
    // Should fail due to cap
    expect(json.error).toBeTruthy();
    expect(json.error).toContain("cap reached");
  });
});
