import { NextResponse } from "next/server";
import { healSheetRun, loadRun, startSheetJob } from "./jobs";
import { defaultRenderDeps } from "./render-deps";
import { runFinal, runPreviews, type RenderDeps } from "./render";

/** The `previews` and `final` actions of POST /api/sheet. Rendering runs as the run's one background job. */
export async function renderAction(body: { runId?: string; versionId?: string }, kind: "previews" | "final", deps: () => RenderDeps = defaultRenderDeps) {
  if (!body.runId) return NextResponse.json({ error: "runId required" }, { status: 400 });
  const found = await loadRun(body.runId);
  if (!found) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const run = await healSheetRun(found);
  if (run.status === "working") return NextResponse.json({ error: "This run is already working on a step." }, { status: 409 });
  if (!run.sheet) return NextResponse.json({ error: "Write the shot sheet first." }, { status: 400 });
  if (run.gate && !run.gate.pass) return NextResponse.json({ error: "The shot sheet gate has errors. Fix them before rendering." }, { status: 400 });
  if (run.cost.spentUsd >= run.cost.capUsd) return NextResponse.json({ error: `The run cap of $${run.cost.capUsd.toFixed(2)} is spent. Raise the cap to render more.` }, { status: 400 });
  await startSheetJob(run, kind === "previews" ? "Rendering previews…" : "Rendering the final…", async (r) => {
    if (kind === "previews") await runPreviews(r, deps(), { versionId: body.versionId });
    else await runFinal(r, deps());
  });
  return NextResponse.json({ run });
}
