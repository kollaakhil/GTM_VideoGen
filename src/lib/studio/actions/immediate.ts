import { overrideStage as setOverride, saveStage } from "@/lib/stage-policy";
import { NextResponse } from "next/server";
import { diversityIssues, selectDiverse } from "@/lib/concepts";
import { MODELS, providerConfigured } from "@/lib/models";
import { put } from "@/lib/store";
import type { Brief, StudioRun } from "@/lib/types";
import type { Parsed } from "../schema";
import { CostMeter } from "@/lib/render/cost-meter";
import { jobs, meters, now, say, stopProgress } from "../run-state";
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

/** Per-shot video model and lens. A changed model or lens re-renders only that shot on the next take. */
export async function shotSettings(run: StudioRun, body: Body<"shot_settings">) {
  const d = run.directions.find((x) => x.id === body.directionId);
  const s = d?.shots?.find((x) => x.id === body.shotId);
  if (!d || !s) return NextResponse.json({ error: "Shot not found" }, { status: 404 });
  if (body.model && !MODELS.some((m) => m.id === body.model && m.modality === "video" && providerConfigured(m.provider))) {
    return NextResponse.json({ error: `Video model ${body.model} isn't available` }, { status: 400 });
  }
  if (body.model !== undefined) s.model = body.model;
  if (body.lens !== undefined) s.lens = body.lens;
  run.updatedAt = now();
  await put("studio_runs", run);
  return NextResponse.json({ run });
}

/** The human checkpoint between cheap 480p takes and the HD upscale: only an approved take is upscaled. */
export async function approveTake(run: StudioRun, body: Body<"approve_take">, user: string) {
  const d = run.directions.find((x) => x.id === body.directionId);
  const take = d?.takes?.find((t) => t.id === body.takeId);
  if (!d || !take) return NextResponse.json({ error: "Take not found" }, { status: 404 });
  if (take.storyboardKey !== d.storyboardKey) return NextResponse.json({ error: "The storyboard changed after this take. Render a new take first." }, { status: 400 });
  for (const t of d.takes!) t.approvedBy = t.id === take.id ? user : null;
  d.approvedTakeId = take.id;
  // The gate chips follow the approved take, so its own video, sound and edit scores are what HD is checked against.
  for (const g of take.stages ?? []) saveStage(run, g, d.id);
  say(run, "agent", `Approved take ${d.takes!.indexOf(take) + 1} (${take.score}/10${take.pass ? "" : ", below the 9/10 bar: the HD export must still pass QA before publishing"}). Upscaling keeps these exact shots, voice and music.`);
  run.updatedAt = now();
  await put("studio_runs", run);
  return NextResponse.json({ run });
}

/** A human lets a stage through below its threshold; the reason and who did it are kept on the score. */
export async function overrideStage(run: StudioRun, body: Body<"override_stage">, user: string) {
  if (!setOverride(run, body.key, user, body.reason)) return NextResponse.json({ error: "That stage hasn't been scored yet" }, { status: 404 });
  const s = run.stageScores![body.key];
  say(run, "agent", `${user} overrode the ${s.stage} gate at ${s.score}/10: ${body.reason}`);
  run.updatedAt = now();
  await put("studio_runs", run);
  return NextResponse.json({ run });
}

/** Raises or lowers the run's spend cap. Takes effect immediately, including for a job already running. */
export async function setCap(run: StudioRun, body: Body<"set_cap">) {
  run.capUsd = body.capUsd;
  const live = meters.get(run.id);
  if (live) live.setCap(body.capUsd);
  else run.meter = new CostMeter({ capUsd: body.capUsd, spentUsd: run.costUsd }).snapshot();
  say(run, "agent", `Spend cap for this run set to $${body.capUsd.toFixed(2)} ($${run.costUsd.toFixed(2)} spent so far).`);
  run.updatedAt = now();
  await put("studio_runs", run);
  return NextResponse.json({ run });
}
