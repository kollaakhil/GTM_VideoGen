import { MODELS, providerConfigured } from "@/lib/models";
import { draftVideoBlocker, videoReady } from "@/lib/quality-policy";
import { finalBlockers, overrideStage, stageBlock, stageKey } from "@/lib/stage-policy";
import type { StudioRun } from "@/lib/types";
import { say } from "../run-state";
import { renderVideo } from "../video";
import type { Job, ActionBody } from "./types";

/** Smallest budget left worth starting another 480p take with. */
const MIN_TAKE_USD = 0.25;

export async function planRenderVideo(run: StudioRun, body: ActionBody<"render_video">): Promise<Job> {
  const d = run.directions.find((x) => x.id === body.directionId);
  const plan = run.videoPlan;
  if (!d || !plan) return { error: "Build a storyboard with keyframes before rendering." };
  const missing = draftVideoBlocker(d, plan);
  if (missing) return { error: missing };
  const shotGate = stageBlock(run, "shots", d.id);
  if (shotGate) return { error: shotGate };
  if (body.tier === "final") {
    const blockers = finalBlockers(run, d.id);
    // "Make final anyway" is the human override: every failing gate is overridden on the record and the blockers
    // become review findings on the export, so the final video exists but still can't be published until fixed.
    if (blockers.length && !body.acceptWarnings) return { error: `Before upgrading to HD: ${blockers[0]}` };
    const take = d.takes?.find((t) => t.id === d.approvedTakeId);
    if (!take || take.storyboardKey !== d.storyboardKey) return { error: "Approve a 480p take of this storyboard before upscaling to HD." };
    if (blockers.length) {
      for (const g of take.stages ?? []) if (!g.pass) overrideStage(run, stageKey(g.stage, d.id), "operator", "Made the final video with warnings");
      say(run, "agent", `Making the final video with ${blockers.length} warning${blockers.length === 1 ? "" : "s"}. It stays unpublishable until they're fixed.`);
    }
  }
  for (const m of [body.draftModel]) {
    if (m && !MODELS.some((x) => x.id === m && x.modality === "video" && providerConfigured(x.provider))) return { error: `Video model ${m} isn't available` };
  }
  if (body.draftModel) plan.draftModel = body.draftModel;
  const takes = body.tier === "final" ? 1 : Math.max(1, Math.min(3, body.takes ?? plan.takes ?? 1));
  return {
    retry: { ...body },
    activity: body.tier === "final"
      ? `Upscaling the approved take of “${d.title}” to HD and re-running QA…`
      : `Rendering ${takes === 1 ? "a 480p take" : `up to ${takes} 480p takes`} of “${d.title}”: ${d.shots!.length} shots, voice, music and QA…`,
    work: async () => {
      let left = plan.budgetUsd;
      for (let k = 0; k < takes; k++) {
        if (k > 0 && left < MIN_TAKE_USD) {
          say(run, "agent", `Stopped after ${k} takes: $${left.toFixed(2)} of the cap is left.`);
          break;
        }
        const r = await renderVideo(run, d, body.tier, left, { acceptWarnings: !!body.acceptWarnings });
        left -= r.spent;
        run.stage = "qa";
        for (const w of r.warnings) say(run, "error", w);
        const label = body.tier === "final" ? "HD upscale" : `480p take ${d.takes?.length ?? k + 1}`;
        say(run, "agent", `Saved the ${label} for “${d.title}”: QA ${r.quality.status}, ${r.quality.score}/10, $${r.spent.toFixed(2)}.${videoReady(r.quality) ? "" : " Open the timestamped report for fixes."}`);
        if (videoReady(r.quality)) break;
      }
    },
  };
}

