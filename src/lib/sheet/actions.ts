import { NextResponse } from "next/server";
import { z } from "zod";
import { loadRun, saveProgress } from "./jobs";
import { validateStack, normalizeStack, type VersionStack } from "@/lib/versions";
import type { Version } from "./run-types";
import { renderAction } from "./render-actions";
import { startSheetJob } from "./jobs";
import { estimateSheetVersion, runPreviews, type RenderDeps } from "./render";
import { DEFAULT_SHEET_VIDEO_MODEL, defaultRenderDeps } from "./render-deps";

const VersionStackSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  models: z.record(z.string(), z.string()),
  estimatedCostUsd: z.number(),
});

/** Steps 4 and 5 of POST /api/sheet: start_versions (render 2-4 stacks), pick_winner, previews and final. */
export async function sheetActions(raw: unknown, _user: string, deps: (stackModels?: Partial<Record<string, string>>) => RenderDeps = defaultRenderDeps): Promise<Response | null> {
  const a = (raw as { action?: string } | null)?.action;
  
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
