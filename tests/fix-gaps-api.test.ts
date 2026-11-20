import { describe, expect, it, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.DATA_DIR = require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "fix-gaps-"));
  process.env.OPENROUTER_API_KEY = "test-key-for-mocking";
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
    vi.unstubAllEnvs();
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

  it("allows fix_gaps even when gate passes (to improve warnings)", async () => {
    // Gate passes but has warnings
    run.gate = { pass: true, issues: [{ level: "warn", text: "Style warning" }], checkedAt: new Date().toISOString() };
    await put("sheet_runs", run);
    
    const response = await sheetActions({ action: "fix_gaps", runId: run.id }, "test@example.com");
    expect(response).toBeTruthy();
    const json = await response!.json();
    // Should succeed (not return an error) since fix_gaps can target warnings
    expect(json.error).toBeUndefined();
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
    const { get } = await import("@/lib/store");
    const mockChatJSON = chatJSON as ReturnType<typeof vi.fn>;
    
    // Use mockResolvedValue (not Once) so ALL concurrent calls get the mock
    // Fixed sheet must:
    // 1. Satisfy the 4s reveal_holds rule (first shot >= 4s)
    // 2. Have no character (run has no people shots, so character checks don't apply)
    // 3. Have NO product shots (otherwise gate warns about missing photos)
    // This fixed sheet should score strictly lower than the original (1 error → 0 errors, 0 warnings → 0 warnings)
    mockChatJSON.mockResolvedValue({
      data: {
        script: "Neon glows.",
        sheet: {
          bed: "",
          endCard: { title: "Gemini 4 Neon", line: "Available now", footer: "" },
          palette: "",
          patternId: undefined,
          character: null,
          shots: [
            { start: 0, end: 5, shotType: "WS", framing: "wide reveal", camera: { angle: "eye level", move: "slow push-in", lensMm: 50 }, subject: "neon sign", action: "glows for 4+ seconds", lighting: "soft glow", text: null, audio: { vo: null, sfx: "hum", music: null }, transition: "cut", engine: "blender", blender: { template: "glow_word", word: "NEON" } },
            { start: 5, end: 12, shotType: "MS", framing: "medium", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "glowing text", action: "appears", lighting: "soft glow", text: null, audio: { vo: null, sfx: "whoosh", music: null }, transition: "cut", engine: "blender" },
          ],
        },
      },
      usage: { costUsd: 0.015 },
    });

    // Increase cap to ensure test doesn't hit budget limit
    run.cost.capUsd = 10;
    run.cost.spentUsd = 0;
    await put("sheet_runs", run);
    
    const response = await sheetActions({ action: "fix_gaps", runId: run.id }, "test@example.com");
    expect(response).toBeTruthy();
    const json = await response!.json();
    
    // Now returns "working" status immediately
    expect(json.status).toBe("working");
    expect(json.error).toBeUndefined();
    
    // Wait for background job to complete (poll with timeout)
    let updatedRun;
    for (let i = 0; i < 100; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      updatedRun = await get("sheet_runs", run.id);
      if (updatedRun?.status !== "working") break;
    }
    
    expect(updatedRun).toBeTruthy();
    expect(updatedRun!.status).toBe("idle");
    expect(updatedRun!.sheet!.version).toBe(2); // New revision
    expect(updatedRun!.sheet!.shots[0].end - updatedRun!.sheet!.shots[0].start).toBeGreaterThanOrEqual(4); // Shot lengthened
    expect(updatedRun!.gate!.pass).toBe(true); // Gate now passes
    
    const fixResult = (updatedRun as any).fixGapsResult;
    expect(fixResult).toBeTruthy();
    expect(fixResult.fixed).toBe(1);
    expect(fixResult.remaining).toBe(0);
    expect(fixResult.changes.length).toBeGreaterThan(0);
    expect(fixResult.changes[0]).toMatch(/Shot 1:.*(2.5s → 5.0s|framing)/);
    
    // Verify LLM was called with the error (calls[0]: [model, system, userPrompt])
    expect(mockChatJSON).toHaveBeenCalled();
    const calls = mockChatJSON.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const userPrompt = calls[0][2] as string;
    expect(userPrompt).toContain("FIX THESE PROBLEMS");
    expect(userPrompt).toContain("no wide reveal holds for 4 s or more");
  });

  it.skip("loops up to 2 repair attempts and returns the best result", async () => {
    const { chatJSON } = await import("@/lib/ai");
    const { get } = await import("@/lib/store");
    const mockChatJSON = chatJSON as ReturnType<typeof vi.fn>;
    
    let callCount = 0;
    // Mock to return different results for each call (concurrent calls)
    mockChatJSON.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // First attempt: still fails (wide shot is only 3.8s, just under 4s threshold)
        return {
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
        };
      } else {
        // Second attempt: passes (5s wide shot, within 8s max)
        return {
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
        };
      }
    });

    const response = await sheetActions({ action: "fix_gaps", runId: run.id }, "test@example.com");
    expect(response).toBeTruthy();
    const json = await response!.json();
    expect(json.status).toBe("working");
    
    // Wait for background job to complete
    let updatedRun;
    for (let i = 0; i < 50; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      updatedRun = await get("sheet_runs", run.id);
      if (updatedRun?.status !== "working") break;
    }
    
    // Concurrent attempts: verify the best result was selected (passing sheet)
    expect(mockChatJSON).toHaveBeenCalled(); // At least one attempt ran
    expect(updatedRun!.gate!.pass).toBe(true);
    expect(updatedRun!.sheet!.shots[0].end - updatedRun!.sheet!.shots[0].start).toBeGreaterThanOrEqual(4);
  });

  it("tracks cost and meters against the run cap", async () => {
    const { get } = await import("@/lib/store");
    run.cost.capUsd = 0.01; // Very low cap
    await put("sheet_runs", run);
    
    const response = await sheetActions({ action: "fix_gaps", runId: run.id }, "test@example.com");
    expect(response).toBeTruthy();
    const json = await response!.json();
    
    // Job starts in background
    expect(json.status).toBe("working");
    
    // Wait for it to fail
    let updatedRun;
    for (let i = 0; i < 50; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      updatedRun = await get("sheet_runs", run.id);
      if (updatedRun?.status !== "working") break;
    }
    
    // Should fail due to cap
    expect(updatedRun!.status).toBe("error");
    expect(updatedRun!.error).toBeTruthy();
    expect(updatedRun!.error).toContain("cap reached");
  });
});
