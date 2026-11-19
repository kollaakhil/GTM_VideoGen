import { NextResponse } from "next/server";
import { healSheetRun, loadRun, startSheetJob } from "./jobs";
import { defaultRenderDeps } from "./render-deps";
import { runFinal, runPreviews, type RenderDeps } from "./render";

/** The `previews` and `final` actions of POST /api/sheet. Rendering runs as the run's one background job. */
export async function renderAction(body: { runId?: string; versionId?: string }, kind: "previews" | "final", deps: (stackModels?: Partial<Record<string, string>>) => RenderDeps = defaultRenderDeps) {
  if (!body.runId) return NextResponse.json({ error: "runId required" }, { status: 400 });
  const found = await loadRun(body.runId);
  if (!found) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const run = await healSheetRun(found);
  if (run.status === "working") return NextResponse.json({ error: "This run is already working on a step." }, { status: 409 });
  if (!run.sheet) return NextResponse.json({ error: "Write the shot sheet first." }, { status: 400 });
  if (run.gate && !run.gate.pass) return NextResponse.json({ error: "The shot sheet gate has errors. Fix them before rendering." }, { status: 400 });
  if (run.cost.spentUsd >= run.cost.capUsd) return NextResponse.json({ error: `The run cap of $${run.cost.capUsd.toFixed(2)} is spent. Raise the cap to render more.` }, { status: 400 });
  
  // Get the version's stack models
  const version = kind === "previews" 
    ? run.versions.find((v) => v.id === body.versionId) || run.versions[0]
    : run.versions.find((v) => v.status === "done") || run.versions[0];
  const stackModels = version?.stack.models;
  
  await startSheetJob(run, kind === "previews" ? "Rendering previews…" : "Rendering the final…", async (r) => {
    if (kind === "previews") await runPreviews(r, deps(stackModels), { versionId: body.versionId });
    else await runFinal(r, deps(stackModels));
  });
  return NextResponse.json({ run });
}
