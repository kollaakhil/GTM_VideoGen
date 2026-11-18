import type { StudioRun } from "@/lib/types";
import { say } from "../run-state";
import { generateMany } from "../creatives";
import type { Job, ActionBody } from "./types";

export async function planGenerate(run: StudioRun, body: ActionBody<"generate">): Promise<Job> {
  if (!run.brief || !run.directions.length) return { error: "Pitch directions first" };
  if (run.directions.some((d) => d.format === "video")) return { error: "Videos must go through Script Lab and the storyboard before rendering." };
  return {
    activity: `Generating ${run.directions.length} ${run.format === "video" ? "videos" : "images"} and running Vision QA…`,
    work: async () => {
      run.creativeIds = [];
      run.progress = Object.fromEntries(run.directions.map((d) => [d.id, "queued" as const]));
      await generateMany(run, run.directions, body.refs ?? []);
      const made = run.creativeIds.length;
      if (made === 0) {
        say(run, "error", "None of the creatives could be generated. Check the errors above, switch the model under Models if needed, and generate again.");
        return;
      }
      run.stage = "qa";
      say(run, "agent", `Generated ${made} creative${made === 1 ? "" : "s"}. Ones that pass QA can be sent to the Inbox for publishing.`);
    },
  };
}

export async function planRegenerate(run: StudioRun, body: ActionBody<"regenerate">): Promise<Job> {
  const d = run.directions.find((x) => x.id === body.directionId);
  if (!d) return { error: "Direction not found" };
  if (d.format === "video") return { error: "Use the storyboard render controls to repair or rerender this video." };
  return {
    activity: `Regenerating “${d.title}”…`,
    work: async () => {
      run.progress[d.id] = "queued";
      await generateMany(run, [d], body.refs ?? []);
      say(run, "agent", `Regenerated “${d.title}”.`);
    },
  };
}
