import { organic } from "@/lib/pipeline";
import type { StudioRun } from "@/lib/types";
import { say } from "../run-state";
import { guidance } from "../context";
import type { Job } from "./types";

export async function planOrganic(run: StudioRun): Promise<Job> {
  const m = run.models;
  if (!run.brief || !run.research) return { error: "Write the brief first" };
  return {
    activity: "Writing organic posts for Instagram, TikTok, LinkedIn and X…",
    work: async () => {
      const o = await organic(m.text, run.brief!, run.research!, run.styleDNA, await guidance(run));
      Object.assign(run, { organic: o.data, costUsd: run.costUsd + o.cost });
      say(run, "agent", "Organic posts are ready: Instagram, TikTok, LinkedIn, an X thread and a carousel.");
    },
  };
}
