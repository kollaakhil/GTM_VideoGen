import type { StudioRun } from "@/lib/types";
import type { ActionBody, Job, PlannedBody } from "./types";
import { planResearch } from "./research";
import { planBrief } from "./brief";
import { planConcepts } from "./concepts";
import { planDirections } from "./directions";
import { planGenerate, planRegenerate } from "./generate";
import { planOrganic } from "./organic";
import { planStoryboard, planRedoShot } from "./storyboard";
import { planDraftHooks, planWriteScripts, planApproveScript, planRescoreScript } from "./script";
import { planRenderVideo } from "./render-video";

type Handler<A extends PlannedBody["action"]> = (run: StudioRun, body: ActionBody<A>) => Promise<Job>;

/** One handler per queued Studio action. Each validates the run and returns the job to run in the background. */
const HANDLERS: { [A in PlannedBody["action"]]: Handler<A> } = {
  research: planResearch,
  brief: planBrief,
  directions: planDirections,
  generate: planGenerate,
  concepts: planConcepts,
  organic: planOrganic,
  storyboard: planStoryboard,
  draft_hooks: planDraftHooks,
  write_scripts: planWriteScripts,
  approve_script: planApproveScript,
  rescore_script: planRescoreScript,
  redo_shot: planRedoShot,
  render_video: planRenderVideo,
  regenerate: planRegenerate,
};

export function plan(run: StudioRun, body: PlannedBody): Promise<Job> {
  return (HANDLERS[body.action] as Handler<PlannedBody["action"]>)(run, body as never);
}
