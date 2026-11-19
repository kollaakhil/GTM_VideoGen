import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { blenderQueue } from "@/lib/render/blender-queue";
import { loadRun } from "@/lib/sheet/jobs";

export const maxDuration = 30;

/**
 * GET /api/studio/queue
 * Returns the current Blender render queue state
 */
export async function GET(req: Request) {
  try {
    await currentUser();
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const url = new URL(req.url);
  const runId = url.searchParams.get("runId");
  const versionId = url.searchParams.get("versionId");

  let jobs = blenderQueue.getAll();

  if (runId) {
    jobs = jobs.filter((j) => j.runId === runId);
  }
  if (versionId) {
    jobs = jobs.filter((j) => j.versionId === versionId);
  }

  // Add position information
  const enriched = jobs.map((job) => ({
    ...job,
    position: blenderQueue.getPosition(job.id),
    durationMs: job.finishedAt ? job.finishedAt - (job.startedAt ?? job.enqueuedAt) : job.startedAt ? Date.now() - job.startedAt : null,
    waitMs: job.startedAt ? job.startedAt - job.enqueuedAt : Date.now() - job.enqueuedAt,
  }));

  return NextResponse.json({ jobs: enriched, hasActive: blenderQueue.hasActive() });
}

/**
 * POST /api/studio/queue
 * Cancel jobs by run, version, or job ID
 */
export async function POST(req: Request) {
  let user: string;
  try {
    user = await currentUser();
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { action, runId, versionId, jobId } = body;

  if (action === "cancel") {
    if (jobId) {
      blenderQueue.cancel(jobId);
    } else if (versionId) {
      blenderQueue.cancelVersion(versionId);
    } else if (runId) {
      // Verify the user owns this run
      const run = await loadRun(runId);
      if (!run) {
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }
      if (run.createdBy !== user) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      blenderQueue.cancelRun(runId);
    } else {
      return NextResponse.json({ error: "Must provide runId, versionId, or jobId" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
