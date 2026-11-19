import { describe, expect, it, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.DATA_DIR = require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "fix-revisions-"));
});

import { sheetActions } from "@/lib/sheet/actions";
import { newSheetRun, applySheetEdit } from "@/lib/sheet/flow";
import { put, get } from "@/lib/store";
import type { SheetRun } from "@/lib/sheet/run-types";

vi.mock("@/lib/ai", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/ai")>();
  return {
    ...orig,
    chatJSON: vi.fn(),
  };
});

describe("fix_gaps revisions and undo", () => {
  let run: SheetRun;

  beforeEach(async () => {
    vi.clearAllMocks();
    run = newSheetRun({ brandUrl: "https://example.com", brand: "Test", goal: "Test", facts: "- Fact 1", targetSec: 10 }, "test@example.com");
    run.brief = { objective: "o", audience: "a", insight: "i", offer: "", mandatories: [], kpi: "k" };
    run.research = { summary: "s", audience: "a", tone: "t", valueProps: ["v"], competitors: [], angles: [], sources: [] };
    run.rules = [{ id: "reveal_holds", text: "Hold for 4 seconds", check: "reveal_holds" }];
    run.sheet = {
      version: 1,
      targetSec: 10,
      aspect: "16:9",
      fps: 24,
      audioMode: "foley",
      bed: "",
      palette: "",
      rules: run.rules,
      endCard: { title: "Test", line: "Line", footer: "" },
      shots: [
        { id: "s1", n: 1, start: 0, end: 3, shotType: "WS", framing: "wide", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "x", action: "x", lighting: "x", text: null, audio: { vo: null, sfx: null, music: null }, transition: "cut", engine: "blender", engineLocked: false, editorNote: "" },
      ],
    };
    run.gate = {
      pass: false,
      issues: [{ level: "error", text: 'Rule "Hold for 4 seconds": no wide reveal holds for 4 s or more.', rule: "reveal_holds" }],
      checkedAt: new Date().toISOString(),
    };
    await put("sheet_runs", run);
  });

  it("creates a new revision when fix_gaps is called", async () => {
    const { chatJSON } = await import("@/lib/ai");
    const mockChatJSON = chatJSON as ReturnType<typeof vi.fn>;
    
    // Mock to always return a sheet that passes (matches targetSec, has >=4s wide shot, <=8s per shot)
    mockChatJSON.mockResolvedValue({
      data: {
        script: "x",
        sheet: {
          bed: "", endCard: { title: "Test", line: "Line", footer: "" }, palette: "", patternId: undefined,
          shots: [
            { start: 0, end: 5, shotType: "WS", framing: "wide reveal", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "x", action: "x", lighting: "x", text: null, audio: { vo: null, sfx: "ambience", music: null }, transition: "cut", engine: "blender" },
            { start: 5, end: 10, shotType: "MS", framing: "medium", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "y", action: "y", lighting: "y", text: null, audio: { vo: null, sfx: "whoosh", music: null }, transition: "cut", engine: "blender" },
          ],
        },
      },
      usage: { costUsd: 0.01 },
    });

    const oldVersion = run.sheet!.version;
    const response = await sheetActions({ action: "fix_gaps", runId: run.id }, "test@example.com");
    const json = await response!.json();
    
    expect(json.run.sheet.version).toBe(oldVersion + 1);
    expect(json.run.sheet.version).toBe(2);
  });

  it("preserves the old sheet by storing it in the database before the fix", async () => {
    const { chatJSON } = await import("@/lib/ai");
    const mockChatJSON = chatJSON as ReturnType<typeof vi.fn>;
    
    const oldShot = structuredClone(run.sheet!.shots[0]);
    
    // Mock to always return a sheet that passes (two shots: 5s + 5s = 10s total)
    mockChatJSON.mockResolvedValue({
      data: {
        script: "x",
        sheet: {
          bed: "", endCard: { title: "Test", line: "Line", footer: "" }, palette: "", patternId: undefined,
          shots: [
            { start: 0, end: 5, shotType: "WS", framing: "wide reveal", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "x", action: "x", lighting: "x", text: null, audio: { vo: null, sfx: "ambience", music: null }, transition: "cut", engine: "blender" },
            { start: 5, end: 10, shotType: "MS", framing: "medium", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "y", action: "y", lighting: "y", text: null, audio: { vo: null, sfx: null, music: null }, transition: "cut", engine: "blender" },
          ],
        },
      },
      usage: { costUsd: 0.01 },
    });

    // The old sheet is in the database before fix_gaps
    const oldRun = await get("sheet_runs", run.id);
    expect(oldRun!.sheet!.shots[0].end).toBe(3);
    
    await sheetActions({ action: "fix_gaps", runId: run.id }, "test@example.com");
    
    // After fix_gaps, the new sheet is in the database (first shot is now 5s)
    const newRun = await get("sheet_runs", run.id);
    expect(newRun!.sheet!.shots[0].end).toBe(5);
    
    // User can manually revert by editing the sheet back to the old version (fitTimings will stretch to match targetSec)
    const result = applySheetEdit(newRun!, { ...newRun!.sheet!, shots: [oldShot], version: oldRun!.sheet!.version });
    expect(result).toEqual({ ok: true });
    expect(newRun!.sheet!.shots[0].end).toBe(10); // fitTimings stretches single shot to targetSec
  });

  it("allows operator to undo by manually editing back to old shot durations", async () => {
    const { chatJSON } = await import("@/lib/ai");
    const mockChatJSON = chatJSON as ReturnType<typeof vi.fn>;
    
    const oldSheet = structuredClone(run.sheet!);
    
    // Mock to always return a sheet that passes (two shots: 5s + 5s = 10s total)
    mockChatJSON.mockResolvedValue({
      data: {
        script: "x",
        sheet: {
          bed: "", endCard: { title: "Test", line: "Line", footer: "" }, palette: "", patternId: undefined,
          shots: [
            { start: 0, end: 5, shotType: "WS", framing: "wide reveal", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "x", action: "x", lighting: "x", text: null, audio: { vo: null, sfx: "ambience", music: null }, transition: "cut", engine: "blender" },
            { start: 5, end: 10, shotType: "MS", framing: "medium", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "y", action: "y", lighting: "y", text: null, audio: { vo: null, sfx: null, music: null }, transition: "cut", engine: "blender" },
          ],
        },
      },
      usage: { costUsd: 0.01 },
    });

    const response = await sheetActions({ action: "fix_gaps", runId: run.id }, "test@example.com");
    const json = await response!.json();
    
    // Fixed sheet has 5s first shot
    expect(json.run.sheet.shots[0].end).toBe(5);
    
    // Operator can edit it back (fitTimings will stretch to match targetSec, so end time becomes 10)
    const revertedSheet = { ...json.run.sheet!, shots: oldSheet.shots };
    const result = applySheetEdit(json.run, revertedSheet);
    expect(result).toEqual({ ok: true });
    expect(json.run.sheet.shots[0].end).toBe(10); // fitTimings stretches single shot to targetSec
    expect(json.run.sheet.version).toBe(3); // Version increments again
  });

  it("increments version even when fix_gaps doesn't fully pass the gate", async () => {
    const { chatJSON } = await import("@/lib/ai");
    const mockChatJSON = chatJSON as ReturnType<typeof vi.fn>;
    
    // Mock to return sheets that still fail (wide shot is only 3.5s, < 4s required, but matches targetSec)
    mockChatJSON.mockResolvedValue({
      data: {
        script: "x",
        sheet: {
          bed: "", endCard: { title: "Test", line: "Line", footer: "" }, palette: "", patternId: undefined,
          shots: [
            { start: 0, end: 3.5, shotType: "WS", framing: "wide", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "x", action: "holds 3.5s", lighting: "x", text: null, audio: { vo: null, sfx: "ambience", music: null }, transition: "cut", engine: "blender" },
            { start: 3.5, end: 10, shotType: "MS", framing: "medium", camera: { angle: "eye level", move: "static", lensMm: 50 }, subject: "y", action: "y", lighting: "y", text: null, audio: { vo: null, sfx: "whoosh", music: null }, transition: "cut", engine: "blender" },
          ],
        },
      },
      usage: { costUsd: 0.01 },
    });

    const oldVersion = run.sheet!.version;
    const response = await sheetActions({ action: "fix_gaps", runId: run.id }, "test@example.com");
    const json = await response!.json();
    
    // Version still increments
    expect(json.run.sheet.version).toBeGreaterThan(oldVersion);
    // Gate still fails (sheet duration is 10s but wide shot action is < 4s, so rule still fails)
    expect(json.run.gate.pass).toBe(false);
    // Reports that some issues remain
    expect(json.remaining).toBeGreaterThan(0);
  });
});
