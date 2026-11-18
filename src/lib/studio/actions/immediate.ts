import { NextResponse } from "next/server";
import { diversityIssues, selectDiverse } from "@/lib/concepts";
import { put } from "@/lib/store";
import type { Brief, StudioRun } from "@/lib/types";
import type { Parsed } from "../schema";
import { jobs, now, say, stopProgress } from "../run-state";
import { saveStoryboardPhotos } from "../context";

/** Actions that update the run right away and respond with it (no background job). */
type Body<A extends Parsed["action"]> = Extract<Parsed, { action: A }>;

export async function cancelRun(run: StudioRun) {
  if (run.status !== "working") return NextResponse.json({ error: "Nothing is running" }, { status: 400 });
  if (run.jobId) {
    jobs.get(run.jobId)?.abort();
    jobs.delete(run.jobId);
  }
  stopProgress(run);
  Object.assign(run, { status: "idle", activity: null, jobId: null, job: null, updatedAt: now() });
  say(run, "agent", "Stopped. Anything already sent to a model provider may still be billed. Pick up from here whenever you're ready.");
  await put("studio_runs", run);
  return NextResponse.json({ run });
}

export async function saveStoryboardPhotosAction(run: StudioRun, body: Body<"save_storyboard_photos">) {
  try {
    run.storyboardPhotos = await saveStoryboardPhotos(run.id, body.refs);
    run.updatedAt = now();
    await put("studio_runs", run);
    return NextResponse.json({ run });
  } catch {
    return NextResponse.json({ error: "Couldn’t save product photos. Try uploading them again." }, { status: 503 });
  }
}

export async function editBrief(run: StudioRun, body: Body<"edit_brief">) {
  if (!run.brief) return NextResponse.json({ error: "No brief to edit yet" }, { status: 400 });
  run.brief = body.brief as Brief;
  run.stage = "directions";
  run.directions = [];
  say(run, "agent", "Saved your edits to the brief. Approve it when you're ready for directions.");
  run.updatedAt = now();
  await put("studio_runs", run);
  return NextResponse.json({ run });
}

export async function pickConcepts(run: StudioRun, body: Body<"pick_concepts">) {
  if (!run.concepts?.length) return NextResponse.json({ error: "Build the concept matrix first" }, { status: 400 });
  const ids = new Set(body.ids);
  const chosen = selectDiverse(run.concepts.map((c) => ({ ...c, selected: false })).filter((c) => ids.has(c.id)), ids.size);
  run.concepts = run.concepts.map((c) => ({ ...c, selected: ids.has(c.id), diversity: chosen.find((x) => x.id === c.id)?.diversity ?? c.diversity }));
  run.directions = [];
  const issues = diversityIssues(run.concepts.filter((c) => c.selected));
  say(run, issues.length ? "error" : "agent", issues.length ? `Diversity gate: ${issues.join("; ")}.` : `Picked ${ids.size} concept${ids.size === 1 ? "" : "s"}. They pass the diversity gate.`);
  run.updatedAt = now();
  await put("studio_runs", run);
  return NextResponse.json({ run });
}
