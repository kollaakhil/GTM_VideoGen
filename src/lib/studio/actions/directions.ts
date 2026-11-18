import { stageBlock } from "@/lib/stage-policy";
import { directions } from "@/lib/pipeline";
import { vocBlock } from "@/lib/ad-wisdom";
import type { StudioRun } from "@/lib/types";
import { say } from "../run-state";
import { guidance } from "../context";
import type { Job, ActionBody } from "./types";

export async function planDirections(run: StudioRun, body: ActionBody<"directions">): Promise<Job> {
  const m = run.models;
  if (!run.brief || !run.research) return { error: "Write the brief first" };
  const gate = stageBlock(run, "research");
  if (gate) return { error: gate };
  if (body.format) run.format = body.format;
  return {
    activity: `Pitching ${(run.concepts ?? []).filter((c) => c.selected).length || 3} directions…`,
    work: async () => {
      const picked = (run.concepts ?? []).filter((c) => c.selected);
      const d = await directions(m.text, run.brief!, run.research!, run.format, run.styleDNA, (await guidance(run)) + vocBlock(run.voc), picked);
      if (picked.length) d.data = d.data.slice(0, picked.length);
      Object.assign(run, { directions: d.data, stage: "generate", progress: {}, costUsd: run.costUsd + d.cost });
      say(run, "agent", `Here ${d.data.length === 1 ? "is 1 direction" : `are ${d.data.length} directions`}. Generate creatives when you're happy, or re-pitch.`);
    },
  };
}
