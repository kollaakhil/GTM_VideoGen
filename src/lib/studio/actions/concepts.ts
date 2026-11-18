import { CATEGORIES } from "@/lib/video-plan";
import { STATIC_FORMATS } from "@/lib/ad-wisdom";
import { concepts, diversityIssues } from "@/lib/concepts";
import { list } from "@/lib/store";
import type { StudioRun } from "@/lib/types";
import { say } from "../run-state";
import { hostOf, guidance } from "../context";
import type { Job, ActionBody } from "./types";

export async function planConcepts(run: StudioRun, body: ActionBody<"concepts">): Promise<Job> {
  const m = run.models;
  if (!run.brief || !run.research) return { error: "Write the brief first" };
  if (body.format) run.format = body.format;
  return {
    activity: "Building the concept matrix…",
    work: async () => {
      const swipes = (await list("swipes")).filter((s) => !s.brandUrl || hostOf(s.brandUrl) === hostOf(run.brandUrl)).slice(0, 8);
      const formats = run.format === "video" ? Object.values(CATEGORIES).map((c) => c.label) : STATIC_FORMATS;
      const c = await concepts(m.text, { research: run.research!, brief: run.brief!, voc: run.voc, style: run.styleDNA, swipes, formats, rules: await guidance(run) });
      Object.assign(run, { concepts: c.data, directions: [], stage: "directions", costUsd: run.costUsd + c.cost });
      const issues = diversityIssues(c.data.filter((x) => x.selected));
      say(run, issues.length ? "error" : "agent", issues.length ? `Diversity gate: ${issues.join("; ")}. Pick different concepts or rebuild the matrix.` : `Built ${c.data.length} concepts and picked the 3 most distinct. Swap any, then turn them into directions.`);
    },
  };
}
