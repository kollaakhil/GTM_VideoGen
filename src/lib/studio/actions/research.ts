import { research, styleDNA } from "@/lib/pipeline";
import { brandRules } from "@/lib/brand-rules";
import { voiceOfCustomer } from "@/lib/ad-wisdom";
import type { StudioRun } from "@/lib/types";
import { say } from "../run-state";
import { goalCtx, brandFor } from "../context";
import type { Job } from "./types";

export async function planResearch(run: StudioRun): Promise<Job> {
  const m = run.models;
  return {
    activity: "Researching the brand…",
    work: async () => {
      const [r, dna] = await Promise.all([research(m.text, run.brandUrl, goalCtx(run, brandRules(await brandFor(run)))), run.referenceUrl ? styleDNA(m.text, run.referenceUrl) : null]);
      const voc = await voiceOfCustomer(m.text, run.brandUrl, r.data).catch(() => null);
      if (!voc) say(run, "error", "Couldn't gather customer language from Reddit or reviews; continuing with site research only.");
      Object.assign(run, { research: r.data, voc: voc?.data ?? null, styleDNA: dna?.data ?? null, stage: "brief", costUsd: run.costUsd + r.cost + (dna?.cost ?? 0) + (voc?.cost ?? 0) });
      say(run, "agent", dna ? `Research is done, and I mapped ${dna.data.brand}'s creative style. Next: write the creative brief.` : "Research is done. Next: write the creative brief.");
    },
  };
}
