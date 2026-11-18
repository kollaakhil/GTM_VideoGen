import { MODELS, providerConfigured } from "@/lib/models";
import { QA_PASS } from "@/lib/video-plan";
import { draftVideoBlocker, scriptProductionBlocker, storyboardKeyframeFixes, videoReady } from "@/lib/quality-policy";
import type { StudioRun } from "@/lib/types";
import { say } from "../run-state";
import { renderVideo } from "../video";
import type { Job, ActionBody } from "./types";

export async function planRenderVideo(run: StudioRun, body: ActionBody<"render_video">): Promise<Job> {
  const d = run.directions.find((x) => x.id === body.directionId);
  const plan = run.videoPlan;
  if (!d || !plan) return { error: "Build a storyboard with keyframes before rendering." };
  const missing = draftVideoBlocker(d, plan);
  if (missing) return { error: missing };
  if (body.tier === "final") {
    const blocker = scriptProductionBlocker(d.approvedScript);
    if (blocker) return { error: `Before upgrading to HD: ${blocker}` };
    const weak = storyboardKeyframeFixes(d.shots!);
    if (weak.length) return { error: `Before upgrading to HD: redraw keyframes ${weak.join(", ")} until they match and score ${QA_PASS}/10.` };
    if (d.passingDraft !== d.storyboardKey) return { error: "Pass draft QA for this storyboard before upgrading to HD." };
  }
  for (const m of [body.draftModel, body.finalModel]) {
    if (m && !MODELS.some((x) => x.id === m && x.modality === "video" && providerConfigured(x.provider))) return { error: `Video model ${m} isn't available` };
  }
  if (body.draftModel) plan.draftModel = body.draftModel;
  if (body.finalModel) plan.finalModel = body.finalModel;
  return {
    activity: `Rendering the ${body.tier} video for “${d.title}”: ${d.shots!.length} shots, voice, music and QA…`,
    work: async () => {
      const r = await renderVideo(run, d, body.tier);
      run.stage = "qa";
      for (const w of r.warnings) say(run, "error", w);
      say(run, "agent", `Saved the ${body.tier} for “${d.title}”: QA ${r.quality.status}, ${r.quality.score}/10, $${r.spent.toFixed(2)}.${videoReady(r.quality) ? "" : " Open the timestamped report for fixes."}`);
    },
  };
}
