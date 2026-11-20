import { NextResponse } from "next/server";
import { get } from "@/lib/store";
import { currentUser } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import type { StudioRun } from "@/lib/types";
import { Body } from "@/lib/studio/schema";
import { healOrphan, startJob } from "@/lib/studio/run-state";
import { newRun, runListResponse, runResponse } from "@/lib/studio/runs";
import { approveTake, overrideStage, cancelRun, editBrief, pickConcepts, removeProductPhoto, saveStoryboardPhotosAction, setCap, shotSettings } from "@/lib/studio/actions/immediate";
import { plan } from "@/lib/studio/actions";

export const maxDuration = 300;

export async function GET(req: Request) {
  const runId = new URL(req.url).searchParams.get("runId");
  return runId ? runResponse(runId) : runListResponse();
}

/** Validates the request, loads or creates the run, then hands off to the action's handler in src/lib/studio/actions. */
export async function POST(req: Request) {
  let user: string;
  try {
    user = await currentUser();
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!rateLimit(`studio:${user}`, 40, 10 * 60_000)) return NextResponse.json({ error: "Too many requests. Wait a few minutes." }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const body = parsed.data;

  let run: StudioRun;
  if (body.action === "research") {
    run = newRun(body, user);
  } else {
    const found = await get("studio_runs", body.runId);
    if (!found) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    run = await healOrphan(found);
  }
  if (body.action === "cancel") return cancelRun(run);
  if (body.action === "set_cap") return setCap(run, body);
  if (run.status === "working") return NextResponse.json({ error: "This run is already working on a step" }, { status: 409 });
  if (body.action === "save_storyboard_photos") return saveStoryboardPhotosAction(run, body);
  if (body.action === "remove_product_photo") return removeProductPhoto(run, body);
  if (body.action === "edit_brief") return editBrief(run, body);
  if (body.action === "pick_concepts") return pickConcepts(run, body);
  if (body.action === "shot_settings") return shotSettings(run, body);
  if (body.action === "approve_take") return approveTake(run, body, user);
  if (body.action === "override_stage") return overrideStage(run, body, user);

  const job = await plan(run, body);
  if ("error" in job) return NextResponse.json({ error: job.error }, { status: 400 });
  await startJob(run, job);
  return NextResponse.json({ run });
}
