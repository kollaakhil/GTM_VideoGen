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
import { sheetGate, type GateResult, type GateIssue } from "./gate";
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
    
    // Release the 409 guard and delete from live to prevent stale overwrites
    if (run.status === "working") {
      run.status = "idle";
      run.activity = null;
    }
    
    // Save with a version check to prevent stale job overwrites
    await saveProgress(run);
    
    // TODO: The stale job's whole-run save could still overwrite newer edits (cap, override).
    // Future improvement: add version/timestamp checking in saveProgress to reject stale writes,
    // or make saves merge specific fields instead of replacing the whole run.
    
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
    if (run.createdBy !== user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (run.status === "working") return NextResponse.json({ error: "Run is busy. Cancel the current job or wait for it to finish." }, { status: 409 });

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
    if (run.gate && !run.gate.pass && !run.gateOverride) return NextResponse.json({ error: "The shot sheet gate has errors. Fix them or override to continue." }, { status: 400 });
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
          const jobContext = { runId: r.id, versionId: id, priority: "normal" as const };
          await runPreviews(r, deps(version?.stack.models, jobContext), { versionId: id });
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
    
    // Check if a render is running or fix_gaps is already working
    const hasActiveRender = run.versions.some((v) => v.status === "rendering" || v.status === "queued");
    if (hasActiveRender) return NextResponse.json({ error: "Cannot fix gaps while a render is running" }, { status: 409 });
    if (run.status === "working") return NextResponse.json({ error: "A job is already running on this run" }, { status: 409 });
    
    // Start background job
    await startSheetJob(run, "Fixing gaps...", async (r) => {
      const meter = meterFor(r);
      const chatWithRetry: Chat = async <T,>(system: string, userPrompt: string) => {
        const TEXT_ESTIMATE = 0.02;
        const result = await meter.run({ stage: "fix_gaps", what: "fix gate failures", model: r.input.textModel, estimate: TEXT_ESTIMATE }, async () => {
          const { chatJSON } = await import("@/lib/ai");
          let lastError: Error | null = null;
          
          // Retry on network errors
          for (let retry = 0; retry < 2; retry++) {
            try {
              const { data, usage } = await chatJSON<T>(r.input.textModel, system, userPrompt);
              return { value: { data, usd: usage.costUsd }, usd: usage.costUsd };
            } catch (e) {
              const err = e as Error;
              const isNetworkError = /fetch failed|ConnectTimeoutError|UND_ERR_CONNECT_TIMEOUT|5\d{2}/i.test(err.message);
              lastError = err;
              
              if (isNetworkError && retry < 1) {
                console.warn(`[fix_gaps] Network error on attempt ${retry + 1}, retrying after backoff...`);
                await new Promise(resolve => setTimeout(resolve, (retry + 1) * 2000));
                continue;
              }
              throw err;
            }
          }
          throw lastError!;
        });
        return result;
      };
      
      const input = {
        brand: r.input.brand,
        goal: r.input.goal,
        offer: r.input.offer,
        facts: r.input.facts,
        brief: r.brief,
        research: r.research,
        rules: r.rules,
        targetSec: r.input.targetSec,
        aspect: r.input.aspect,
        audioMode: r.input.audioMode,
        hasPhotos: r.input.photos.length > 0,
        patternId: r.input.patternId,
      };
      
      const oldSheet = r.sheet!;
      const oldVersion = oldSheet.version;
      const oldGate = r.gate!;
      
      // Score: blocking errors * 10 + warnings
      const scoreGate = (gate: GateResult) => {
        const blocking = gate.issues.filter((i: GateIssue) => i.level === "error").length;
        const warnings = gate.issues.filter((i: GateIssue) => i.level === "warn").length;
        return blocking * 10 + warnings;
      };
      
      const bestScore = scoreGate(oldGate);
      const MAX_ATTEMPTS = 2;
      
      // Run attempts concurrently with Promise.all
      const attemptPromises = Array.from({ length: MAX_ATTEMPTS }, (_, i) => {
        const attempt = i + 1;
        return (async () => {
          try {
            // Target both errors and warnings
            const fixes = oldGate.issues;
            const result = await writeSheet(input, chatWithRetry, fixes, oldVersion + attempt);
            const currentSheet = result.sheet;
            const currentGate = sheetGate(currentSheet, { facts: factBase(r), rules: r.rules, hasPhotos: r.input.photos.length > 0 });
            const currentScore = scoreGate(currentGate);
            return { sheet: currentSheet, gate: currentGate, score: currentScore, attempt };
          } catch (e) {
            const errMsg = (e as Error).message;
            console.error(`[fix_gaps] Attempt ${attempt} failed:`, e);
            // If it's a cap error, throw it to stop all attempts
            if (errMsg.includes("cap reached")) {
              throw e;
            }
            // Return null for other errors so we can continue with other attempts
            return null;
          }
        })();
      });
      
      const results = await Promise.all(attemptPromises);
      
      // Filter out failed attempts and find the best result
      const validResults = results.filter((r): r is NonNullable<typeof r> => r !== null);
      
      let bestSheet = oldSheet;
      let bestGate = oldGate;
      let newBestScore = bestScore;
      
      for (const result of validResults) {
        if (result.score < newBestScore) {
          bestSheet = result.sheet;
          bestGate = result.gate;
          newBestScore = result.score;
        }
      }
      
      // Track what changed if we found a better sheet
      const changes: string[] = [];
      if (newBestScore < bestScore) {
        for (let i = 0; i < Math.min(bestSheet.shots.length, oldSheet.shots.length); i++) {
          const oldShot = oldSheet.shots[i];
          const newShot = bestSheet.shots[i];
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
        
        r.sheet = bestSheet;
        r.gate = bestGate;
      }
      
      // Save fix_gaps result in a field the UI can poll
      const originalErrors = oldGate.issues.filter((i) => i.level === "error").length;
      const originalWarnings = oldGate.issues.filter((i) => i.level === "warn").length;
      const bestErrors = bestGate.issues.filter((i) => i.level === "error").length;
      const bestWarnings = bestGate.issues.filter((i) => i.level === "warn").length;
      const improved = newBestScore < bestScore;
      
      // Store result in run for UI to poll (add to run-types.ts)
      // Count both errors and warnings fixed
      (r as { fixGapsResult?: unknown }).fixGapsResult = {
        changes,
        fixed: improved ? (originalErrors - bestErrors) + (originalWarnings - bestWarnings) : 0,
        remaining: bestErrors + bestWarnings,
        message: improved ? undefined : `Couldn't improve automatically; ${oldGate.issues.length} issue(s) remain`,
      };
      
      await saveProgress(r);
    });
    
    return NextResponse.json({ run, status: "working" });
  }
  
  if (a === "override_gate") {
    const body = raw as { runId?: string };
    if (!body.runId) return NextResponse.json({ error: "runId required" }, { status: 400 });
    
    const run = await loadRun(body.runId);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    if (run.createdBy !== user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (!run.gate) return NextResponse.json({ error: "No gate result" }, { status: 400 });
    
    const blockingErrors = run.gate.issues.filter((i) => i.level === "error");
    
    // Cannot override claim or safety issues (superlatives, unverified claims, banned phrases)
    const cannotOverride = blockingErrors.filter((i) => 
      i.text.includes("claims") || 
      i.text.includes("unverified") || 
      i.text.includes("facts mark as") ||
      i.text.includes("verified facts don't support")
    );
    
    if (cannotOverride.length > 0) {
      return NextResponse.json({ 
        error: "Cannot override claim/safety errors. Fix these issues first.",
        cannotOverride: cannotOverride.map(i => i.text),
      }, { status: 400 });
    }
    
    run.gateOverride = {
      at: new Date().toISOString(),
      by: user,
      issues: blockingErrors,
    };
    
    await saveProgress(run);
    
    return NextResponse.json({ run });
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
