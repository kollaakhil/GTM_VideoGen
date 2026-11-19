import { NextResponse } from "next/server";
import { z } from "zod";
import { loadRun, saveProgress, meterFor } from "./jobs";
import { validateStack, normalizeStack, type VersionStack } from "@/lib/versions";
import type { Version } from "./run-types";
import { renderAction } from "./render-actions";
import { startSheetJob } from "./jobs";
import { estimateSheetVersion, runPreviews, type RenderDeps } from "./render";
import { DEFAULT_SHEET_VIDEO_MODEL, defaultRenderDeps } from "./render-deps";
import { blenderQueue } from "@/lib/render/blender-queue";
import { writeSheet, type Chat } from "./writer";
import { sheetGate } from "./gate";
import { factBase } from "./flow";

const VersionStackSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  models: z.record(z.string(), z.string()),
  estimatedCostUsd: z.number(),
});

/** Steps 4 and 5 of POST /api/sheet: start_versions (render 2-4 stacks), pick_winner, previews and final. */
export async function sheetActions(raw: unknown, user: string, deps: (stackModels?: Partial<Record<string, string>>, jobContext?: { runId: string; versionId: string; priority?: "high" | "normal" }) => RenderDeps = defaultRenderDeps): Promise<Response | null> {
  const a = (raw as { action?: string } | null)?.action;
  
  // Cancel action: cancel render queue jobs for a run or version
  if (a === "cancel") {
    const body = raw as { runId?: string; versionId?: string };
    if (!body.runId) return NextResponse.json({ error: "runId required" }, { status: 400 });
    
    const run = await loadRun(body.runId);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    if (run.createdBy !== user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    
    if (body.versionId) {
      blenderQueue.cancelVersion(body.versionId);
      // Mark version as cancelled
      const version = run.versions.find((v) => v.id === body.versionId);
      if (version && (version.status === "rendering" || version.status === "queued")) {
        version.status = "cancelled";
        version.error = "Cancelled by user";
      }
    } else {
      blenderQueue.cancelRun(body.runId);
      // Mark all queued/rendering versions as cancelled
      run.versions.filter((v) => v.status === "rendering" || v.status === "queued").forEach((v) => {
        v.status = "cancelled";
        v.error = "Cancelled by user";
      });
    }
    
    // Release the 409 guard
    if (run.status === "working") {
      run.status = "idle";
      run.activity = null;
    }
    
    await saveProgress(run);
    return NextResponse.json({ run });
  }
  
  if (a === "start_versions") {
    const body = raw as { runId?: string; stacks?: unknown[] };
    if (!body.runId) return NextResponse.json({ error: "runId required" }, { status: 400 });
    if (!Array.isArray(body.stacks) || body.stacks.length < 2 || body.stacks.length > 4) {
      return NextResponse.json({ error: "Provide 2-4 stacks" }, { status: 400 });
    }

    const run = await loadRun(body.runId);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    if (run.status === "working") return NextResponse.json({ error: "Run is busy" }, { status: 409 });

    // Validate stacks
    const stacks: VersionStack[] = [];
    for (const s of body.stacks) {
      const parsed = VersionStackSchema.safeParse(s);
      if (!parsed.success) {
        return NextResponse.json({ error: `Invalid stack: ${parsed.error.issues[0]?.message}` }, { status: 400 });
      }
      const stack = normalizeStack(parsed.data as VersionStack);
      const errors = validateStack(stack);
      if (errors.length > 0) {
        return NextResponse.json({ error: `Stack ${stack.label}: ${errors.join(", ")}` }, { status: 400 });
      }
      stacks.push(stack);
    }

    if (!run.sheet) return NextResponse.json({ error: "Write the shot sheet first." }, { status: 400 });
    if (run.gate && !run.gate.pass) return NextResponse.json({ error: "The shot sheet gate has errors. Fix them before rendering." }, { status: 400 });
    // Budget from the sheet itself (server side; the client's whole-video guess is ignored): every version must fit the cap together.
    const sheet = run.sheet;
    const estimates = stacks.map((st) => estimateSheetVersion(sheet, st, DEFAULT_SHEET_VIDEO_MODEL()));
    const totalCost = estimates.reduce((sum, e) => sum + e.usd, 0);
    const remaining = run.cost.capUsd - run.cost.spentUsd;
    if (totalCost > remaining + 1e-9) {
      return NextResponse.json({
        error: `These ${stacks.length} versions need about $${totalCost.toFixed(2)} but $${Math.max(0, remaining).toFixed(2)} of the $${run.cost.capUsd.toFixed(2)} cap is left. Drop a version, pick cheaper stacks or raise the cap.`,
      }, { status: 400 });
    }

    const stamp = Date.now().toString(36);
    run.versions = [
      ...run.versions.filter((v) => v.tier !== "preview"),
      ...stacks.map((stack, i): Version => ({
        id: `${run.id}-${stack.id}-${stamp}`,
        stack: { ...stack, estimatedCostUsd: estimates[i].usd },
        tier: "preview",
        status: "queued",
        estimate: estimates[i],
        shots: [],
        videoUrl: null,
        contactUrl: null,
        usd: 0,
        ms: 0,
      })),
    ];
    run.picks = { mode: "video", video: null, shots: {} };
    run.step = "previews";

    // One background job renders the versions one after another (each renders its shots in parallel); Blender and
    // Remotion shots the versions share come from the cache, so only what differs is rendered twice.
    const ids = run.versions.filter((v) => v.tier === "preview").map((v) => v.id);
    await startSheetJob(run, `Rendering ${ids.length} versions…`, async (r) => {
      for (const [i, id] of ids.entries()) {
        r.activity = `Rendering version ${i + 1} of ${ids.length}: ${r.versions.find((v) => v.id === id)?.stack.label ?? id}…`;
        await saveProgress(r);
        const version = r.versions.find((v) => v.id === id);
        try {
          await runPreviews(r, deps(version?.stack.models), { versionId: id });
        } catch (e) {
          if (version) Object.assign(version, { status: "failed", error: (e as Error).message.slice(0, 400) });
          await saveProgress(r);
        }
      }
    });
    return NextResponse.json({ run });
  }

  if (a === "fix_gaps") {
    const body = raw as { runId?: string };
    if (!body.runId) return NextResponse.json({ error: "runId required" }, { status: 400 });
    
    const run = await loadRun(body.runId);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    if (run.createdBy !== user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (!run.sheet) return NextResponse.json({ error: "No sheet to fix" }, { status: 400 });
    if (!run.gate) return NextResponse.json({ error: "No gate result" }, { status: 400 });
    if (run.gate.pass) return NextResponse.json({ error: "Sheet already passes the gate" }, { status: 400 });
    
    // Check if a render is running
    const hasActiveRender = run.versions.some((v) => v.status === "rendering" || v.status === "queued");
    if (hasActiveRender) return NextResponse.json({ error: "Cannot fix gaps while a render is running" }, { status: 409 });
    
    const meter = meterFor(run);
    const chat: Chat = async <T,>(system: string, userPrompt: string) => {
      const TEXT_ESTIMATE = 0.02;
      const result = await meter.run({ stage: "fix_gaps", what: "fix gate failures", model: run.input.textModel, estimate: TEXT_ESTIMATE }, async () => {
        const { chatJSON } = await import("@/lib/ai");
        const { data, usage } = await chatJSON<T>(run.input.textModel, system, userPrompt);
        return { value: { data, usd: usage.costUsd }, usd: usage.costUsd };
      });
      return result;
    };
    
    const input = {
      brand: run.input.brand,
      goal: run.input.goal,
      offer: run.input.offer,
      facts: run.input.facts,
      brief: run.brief,
      research: run.research,
      rules: run.rules,
      targetSec: run.input.targetSec,
      aspect: run.input.aspect,
      audioMode: run.input.audioMode,
      hasPhotos: run.input.photos.length > 0,
      patternId: run.input.patternId,
    };
    
    const oldSheet = run.sheet;
    const oldVersion = oldSheet.version;
    let currentSheet = oldSheet;
    let currentGate = run.gate;
    const errors = currentGate.issues.filter((i) => i.level === "error");
    
    const changes: string[] = [];
    let bestSheet = currentSheet;
    let bestGate = currentGate;
    const MAX_ATTEMPTS = 2;
    
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !currentGate.pass; attempt++) {
      try {
        const fixes = currentGate.issues.filter((i) => i.level === "error");
        const result = await writeSheet(input, chat, fixes, oldVersion + attempt);
        currentSheet = result.sheet;
        currentGate = sheetGate(currentSheet, { facts: factBase(run), rules: run.rules });
        
        // Track what changed
        for (let i = 0; i < Math.min(currentSheet.shots.length, oldSheet.shots.length); i++) {
          const oldShot = oldSheet.shots[i];
          const newShot = currentSheet.shots[i];
          const durationChanged = Math.abs((newShot.end - newShot.start) - (oldShot.end - oldShot.start)) > 0.1;
          const framingChanged = oldShot.shotType !== newShot.shotType || oldShot.framing !== newShot.framing;
          
          if (durationChanged || framingChanged) {
            const oldDur = (oldShot.end - oldShot.start).toFixed(1);
            const newDur = (newShot.end - newShot.start).toFixed(1);
            const parts: string[] = [];
            if (durationChanged) parts.push(`${oldDur}s → ${newDur}s`);
            if (framingChanged) parts.push(`framing now ${newShot.shotType}`);
            changes.push(`Shot ${i + 1}: ${parts.join(", ")}`);
          }
        }
        
        // Keep best attempt (passes, or has fewer errors, or this is the first attempt)
        const currentErrors = currentGate.issues.filter((i) => i.level === "error").length;
        const bestErrors = bestGate.issues.filter((i) => i.level === "error").length;
        if (attempt === 1 || currentErrors < bestErrors || currentGate.pass) {
          bestSheet = currentSheet;
          bestGate = currentGate;
        }
      } catch (e) {
        const errMsg = (e as Error).message;
        console.error(`[fix_gaps] Attempt ${attempt} failed:`, e);
        // If it's a cap error, return immediately instead of trying more attempts
        if (errMsg.includes("cap reached")) {
          return NextResponse.json({ error: errMsg }, { status: 400 });
        }
        break;
      }
    }
    
    // Save the best result as a new revision
    run.sheet = bestSheet;
    run.gate = bestGate;
    await saveProgress(run);
    
    const remainingErrors = bestGate.issues.filter((i) => i.level === "error");
    return NextResponse.json({
      run,
      changes,
      fixed: errors.length - remainingErrors.length,
      remaining: remainingErrors.length,
    });
  }

  if (a === "pick_winner") {
    const body = raw as { runId?: string; versionId?: string };
    if (!body.runId || !body.versionId) {
      return NextResponse.json({ error: "runId and versionId required" }, { status: 400 });
    }

    const run = await loadRun(body.runId);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    const winner = run.versions.find((v) => v.id === body.versionId);
    if (!winner) return NextResponse.json({ error: "Version not found" }, { status: 404 });
    if (winner.status !== "done") {
      return NextResponse.json({ error: "Can only pick a completed version" }, { status: 400 });
    }

    // The winner is what Final renders (its stack and its engines).
    run.picks = { mode: "video", video: winner.id, shots: {} };

    // Advance to final step
    run.step = "final";
    run.activity = `Picked ${winner.stack.label} as winner. Ready for final render.`;

    await saveProgress(run);

    return NextResponse.json({ run });
  }

  if (a === "previews" || a === "final") return renderAction(raw as { runId?: string; versionId?: string }, a, deps);

  if (a === "pick") {
    return NextResponse.json({ 
      error: "Legacy rendering actions. Use start_versions instead." 
    }, { status: 501 });
  }
  
  return null;
}
