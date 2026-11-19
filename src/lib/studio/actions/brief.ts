import { vocBlock } from "@/lib/ad-wisdom";
import type { StudioRun } from "@/lib/types";
import { say } from "../run-state";
import { gatedBrief } from "../brief-gate";
import { goalCtx, guidance } from "../context";
import type { Job } from "./types";

export async function planBrief(run: StudioRun): Promise<Job> {
  const m = run.models;
  if (!run.research) return { error: "Run research first" };
  return {
    activity: "Writing the brief…",
    work: async () => {
      const b = await gatedBrief(run, m.text, goalCtx(run, (await guidance(run)) + vocBlock(run.voc)));
      Object.assign(run, { brief: b.data, stage: "directions", directions: [], concepts: [], costUsd: run.costUsd + b.cost });
      say(run, "agent", `Brief is ready. Edit it if you like, then approve it to build the concept matrix.${b.line}`);
    },
  };
}
