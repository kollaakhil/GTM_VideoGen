import { NextResponse } from "next/server";
import { z } from "zod";
import { loadRun, saveProgress } from "./jobs";
import { validateStack, normalizeStack, type VersionStack } from "@/lib/versions";
import type { Version } from "./run-types";
import { renderAction } from "./render-actions";

const VersionStackSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  models: z.record(z.string(), z.string()),
  estimatedCostUsd: z.number(),
});

/**
 * Hook for the render pipeline: previews, final and picks are handled here once it lands. Until then they answer 501
 * so Studio can say so plainly.
 */
export async function sheetActions(raw: unknown, _user: string): Promise<Response | null> {
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

    // Check budget
    const totalCost = stacks.reduce((sum, s) => sum + s.estimatedCostUsd, 0);
    const remaining = run.cost.capUsd - run.cost.spentUsd;
    if (totalCost > remaining) {
      return NextResponse.json({ 
        error: `Total cost $${totalCost.toFixed(2)} exceeds remaining budget $${remaining.toFixed(2)}` 
      }, { status: 400 });
    }

    // Create version entries
    run.versions = stacks.map((stack) => {
      const version: Version = {
        id: `${run.id}-${stack.id}-${Date.now()}`,
        stack,
        tier: "preview",
        status: "queued",
        estimate: {
          usd: stack.estimatedCostUsd,
          lines: Object.entries(stack.models).map(([stage, model]) => ({
            what: stage,
            model,
            usd: 0,
          })),
          blocked: [],
        },
        shots: [],
        videoUrl: null,
        contactUrl: null,
        usd: 0,
        ms: 0,
      };
      return version;
    });

    await saveProgress(run);

    // Rendering not wired yet - return pending state
    return NextResponse.json({ 
      run,
      message: "Versions queued. Rendering will be wired in a future PR." 
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

    // Store the winner's stack as the final picks
    run.picks = {
      mode: "video",
      video: null,
      shots: {},
    };

    // Advance to final step
    run.step = "final";
    run.activity = `Picked ${winner.stack.label} as winner. Ready for final render.`;

    await saveProgress(run);

    return NextResponse.json({ run });
  }

  if (a === "previews" || a === "final") return renderAction(raw as { runId?: string; versionId?: string }, a);

  if (a === "pick") {
    return NextResponse.json({ 
      error: "Legacy rendering actions. Use start_versions instead." 
    }, { status: 501 });
  }
  
  return null;
}
