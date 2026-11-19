import { describe, expect, it, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.DATA_DIR = require("node:fs").mkdtempSync(
    require("node:path").join(require("node:os").tmpdir(), "versions-api-")
  );
});

import { sheetActions } from "@/lib/sheet/actions";
import { newSheetRun } from "@/lib/sheet/flow";
import { loadRun } from "@/lib/sheet/jobs";
import { put } from "@/lib/store";
import { PRESET_STACKS, getPresetsWithCosts } from "@/lib/versions";
import { memoryCache } from "@/lib/render/cache";
import type { RenderDeps } from "@/lib/sheet/render";

// Never render for real here: every action gets mock renderers (free, instant).
const mockDeps = (): RenderDeps => {
  const mk = (id: "ai-video" | "blender" | "remotion") => ({ id, available: async () => true, estimateUsd: () => 0, render: async (row: { id: string }) => ({ url: `data:video/mp4;base64,${id}-${row.id}`, costUsd: 0 }) });
  return {
    renderers: { "ai-video": mk("ai-video"), blender: mk("blender"), remotion: mk("remotion") },
    photos: async () => [], store: async (d) => d,
    shotCheck: { frame: async (c) => c, review: async () => ({ score: 8, notes: [] }) },
    stitch: async (clips) => ({ url: `data:video/mp4;base64,cut${clips.length}`, starts: [0], duration: 5 }),
    final: () => ({ review: async () => ({ score: 9, notes: ["ok"] }), loudness: async () => ({ lufs: -14, peak: -2 }), ocr: async () => [], sync: async () => null }),
    clipCache: memoryCache(), judgeCache: memoryCache(),
  } as RenderDeps;
};
const act = (body: Record<string, unknown>) => sheetActions(body, "test-user", () => mockDeps());
async function settle(id: string) {
  for (let i = 0; i < 100; i++) {
    const r = await loadRun(id);
    if (r && r.status !== "working") return r;
    await new Promise((ok) => setTimeout(ok, 20));
  }
  throw new Error("job did not finish");
}

describe("Versions API", () => {
  let runId: string;

  beforeEach(async () => {
    const run = newSheetRun(
      {
        brandUrl: "https://example.com",
        brand: "Test Brand",
        goal: "Test video",
        facts: "Test facts",
        targetSec: 20,
      },
      "test-user"
    );
    run.brief = {
      objective: "Test",
      audience: "Test",
      insight: "Test",
      offer: "Test",
      mandatories: [],
      kpi: "Test",
    };
    run.rules = [];
    run.script = "Test script";
    run.sheet = {
      version: 1,
      targetSec: 20,
      aspect: "16:9",
      fps: 24,
      audioMode: "foley",
      bed: "test bed",
      palette: "test palette",
      rules: [],
      shots: [
        {
          id: "s1",
          n: 1,
          start: 0,
          end: 5,
          shotType: "CU",
          framing: "test",
          camera: { angle: "eye level", move: "static", lensMm: 50 },
          subject: "test subject",
          action: "test action",
          lighting: "test lighting",
          text: null,
          audio: { vo: null, sfx: "test sfx", music: null },
          transition: "cut",
          engine: "blender",
          engineLocked: false,
          editorNote: "",
        },
      ],
      endCard: { title: "Test", line: "Test", footer: "Test" },
    };
    run.gate = { pass: true, issues: [], checkedAt: new Date().toISOString() };
    run.step = "previews";
    run.cost.capUsd = 10.0; // Higher cap to accommodate version stacks
    
    await put("sheet_runs", run);
    runId = run.id;
  });

  describe("start_versions", () => {
    it("accepts 2-4 valid stacks", async () => {
      const stacks = getPresetsWithCosts({ shots: 1, targetSec: 20 }).slice(0, 2);
      const res = await act({ action: "start_versions", runId, stacks });
      
      expect(res).toBeTruthy();
      const json = await res!.json();
      if (json.error) {
        throw new Error(`API returned error: ${json.error}`);
      }
      expect(json.run).toBeDefined();
      expect(json.run.versions).toHaveLength(2);
    });

    it("rejects less than 2 stacks", async () => {
      const stacks = getPresetsWithCosts({ shots: 1, targetSec: 20 }).slice(0, 1);
      const res = await act({ action: "start_versions", runId, stacks });
      
      expect(res).toBeTruthy();
      const json = await res!.json();
      expect(json.error).toMatch(/2-4 stacks/);
    });

    it("rejects more than 4 stacks", async () => {
      const stacks = [
        ...getPresetsWithCosts({ shots: 1, targetSec: 20 }),
        getPresetsWithCosts({ shots: 1, targetSec: 20 })[0],
      ];
      const res = await act({ action: "start_versions", runId, stacks });
      
      expect(res).toBeTruthy();
      const json = await res!.json();
      expect(json.error).toMatch(/2-4 stacks/);
    });

    it("rejects invalid model ids", async () => {
      const stacks = [
        {
          id: "invalid1",
          label: "Invalid 1",
          description: "Invalid stack",
          models: { research: "fake/model-999" },
          estimatedCostUsd: 0,
        },
        {
          id: "invalid2",
          label: "Invalid 2",
          description: "Another invalid",
          models: { video: "fake/video-model" },
          estimatedCostUsd: 0,
        },
      ];
      const res = await act({ action: "start_versions", runId, stacks });
      
      expect(res).toBeTruthy();
      const json = await res!.json();
      expect(json.error).toMatch(/not found/);
    });

    it("rejects models on wrong stages", async () => {
      const stacks = [
        {
          id: "wrong1",
          label: "Wrong stage 1",
          description: "Text model on video stage",
          models: { video: "anthropic/claude-sonnet-5.5" },
          estimatedCostUsd: 0,
        },
        {
          id: "wrong2",
          label: "Wrong stage 2",
          description: "Video model on text stage",
          models: { research: "bytedance/seedance-2.0-fast" },
          estimatedCostUsd: 0,
        },
      ];
      const res = await act({ action: "start_versions", runId, stacks });
      
      expect(res).toBeTruthy();
      const json = await res!.json();
      expect(json.error).toMatch(/cannot serve stage/);
    });

    it("enforces budget cap", async () => {
      // Lower the budget cap first
      const run = await loadRun(runId);
      if (run) {
        run.cost.capUsd = 0.5;
        // a 5 s AI-video shot: the premium stack's video model makes it cost more than the cap
        run.sheet!.shots[0].engine = "ai_video";
        await put("sheet_runs", run);
      }
      const stacks = getPresetsWithCosts({ shots: 1, targetSec: 5 }).slice(0, 2);
      const res = await act({ action: "start_versions", runId, stacks });
      
      expect(res).toBeTruthy();
      const json = await res!.json();
      expect(json.error).toMatch(/cap is left/);
      expect((await loadRun(runId))!.versions).toHaveLength(0);
    });

    it("creates version entries with queued status", async () => {
      const stacks = getPresetsWithCosts({ shots: 1, targetSec: 20 }).slice(0, 2);
      const res = await act({ action: "start_versions", runId, stacks });
      
      expect(res).toBeTruthy();
      const json = await res!.json();
      expect(json.run.versions).toHaveLength(2);
      
      for (const version of json.run.versions) {
        expect(["queued", "rendering", "done"]).toContain(version.status);
        expect(version.tier).toBe("preview");
        expect(version.stack).toBeDefined();
        expect(version.estimate).toBeDefined();
        expect(version.shots).toEqual([]);
        expect(version.videoUrl).toBeNull();
      }
    });

    it("normalizes stacks to fill missing stages", async () => {
      const partialStacks = [
        {
          id: "partial1",
          label: "Partial 1",
          description: "Only video",
          models: { video: "bytedance/seedance-2.0-fast" },
          estimatedCostUsd: 0.1,
        },
        {
          id: "partial2",
          label: "Partial 2",
          description: "Only research",
          models: { research: "anthropic/claude-sonnet-5.5" },
          estimatedCostUsd: 0.1,
        },
      ];
      
      const res = await act({ action: "start_versions", runId, stacks: partialStacks });
      
      expect(res).toBeTruthy();
      const json = await res!.json();
      expect(json.run.versions).toHaveLength(2);
      
      // Normalized stacks should have all stages
      for (const version of json.run.versions) {
        expect(version.stack.models).toHaveProperty("research");
        expect(version.stack.models).toHaveProperty("video");
      }
    });

    it("renders every version in the background, then they can be compared", async () => {
      const stacks = getPresetsWithCosts({ shots: 1, targetSec: 20 }).slice(0, 2);
      const res = await act({ action: "start_versions", runId, stacks });
      expect((await res!.json()).run.status).toBe("working");
      const run = await settle(runId);
      expect(run.status).toBe("idle");
      expect(run.versions.map((v) => v.status)).toEqual(["done", "done"]);
      expect(run.versions.every((v) => v.videoUrl && v.score === 8)).toBe(true);
    });
  });

  describe("pick_winner", () => {
    it("picks a completed version as winner", async () => {
      // First start versions
      const stacks = getPresetsWithCosts({ shots: 1, targetSec: 20 }).slice(0, 2);
      const startRes = await act({ action: "start_versions", runId, stacks });
      await startRes!.json();
      const run = await settle(runId);
      
      const versionId = run.versions[0].id;
      const res = await act({ action: "pick_winner", runId, versionId });
      
      expect(res).toBeTruthy();
      const json = await res!.json();
      expect(json.run.step).toBe("final");
      expect(json.run.activity).toMatch(/winner/);
      expect(json.run.picks.video).toBe(versionId);
    });

    it("rejects picking incomplete version", async () => {
      const stacks = getPresetsWithCosts({ shots: 1, targetSec: 20 }).slice(0, 2);
      const startRes = await act({ action: "start_versions", runId, stacks });
      await startRes!.json();
      const run = await settle(runId);
      run.versions[0].status = "failed";
      await put("sheet_runs", run);
      const versionId = run.versions[0].id;
      const res = await act({ action: "pick_winner", runId, versionId });
      
      expect(res).toBeTruthy();
      const json = await res!.json();
      expect(json.error).toMatch(/completed version/);
    });

    it("rejects non-existent version id", async () => {
      const res = await act({ action: "pick_winner", runId, versionId: "fake-version-id" });
      
      expect(res).toBeTruthy();
      const json = await res!.json();
      expect(json.error).toMatch(/Version not found/);
    });

    it("requires both runId and versionId", async () => {
      const res1 = await act({ action: "pick_winner", versionId: "test" });
      expect(res1).toBeTruthy();
      const json1 = await res1!.json();
      expect(json1.error).toMatch(/required/);
      
      const res2 = await act({ action: "pick_winner", runId });
      expect(res2).toBeTruthy();
      const json2 = await res2!.json();
      expect(json2.error).toMatch(/required/);
    });
  });

  describe("Render actions", () => {
    it("accepts previews action with versionId", async () => {
      // First create versions
      const stacks = getPresetsWithCosts({ shots: 1, targetSec: 20 }).slice(0, 2);
      await act({ action: "start_versions", runId, stacks });
      const run = await settle(runId);
      
      const res = await act({ action: "previews", runId, versionId: run.versions[0].id });
      expect(res).toBeTruthy();
      const json = await res!.json();
      expect(json.run).toBeDefined();
      expect(json.run.status).toBe("working");
    });

    it("accepts final action", async () => {
      // First create versions and mark one as done
      const stacks = getPresetsWithCosts({ shots: 1, targetSec: 20 }).slice(0, 2);
      await act({ action: "start_versions", runId, stacks });
      const run = await settle(runId);
      run.versions[0].status = "done";
      await put("sheet_runs", run);
      
      const res = await act({ action: "final", runId });
      expect(res).toBeTruthy();
      const json = await res!.json();
      expect(json.run).toBeDefined();
      expect(json.run.status).toBe("working");
    });
  });
});
