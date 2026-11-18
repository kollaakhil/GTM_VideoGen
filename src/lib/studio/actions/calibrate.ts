import { aiConfigured } from "@/lib/ai";
import { calibrateJudges } from "@/lib/judge-calibration";
import { gateJudge } from "@/lib/stage-gates";
import type { StudioRun } from "@/lib/types";
import { say } from "../run-state";
import type { Job } from "./types";

/** QA of the QA: score the labeled golden set with this run's gate judge and store bias and disagreements. */
export async function planCalibrate(run: StudioRun): Promise<Job> {
  if (!aiConfigured()) return { error: "Judge calibration needs OPENROUTER_API_KEY." };
  const judge = gateJudge(run);
  return {
    activity: `Calibrating the gate judge (${judge}) on the golden set…`,
    work: async () => {
      const cal = await calibrateJudges(judge);
      run.costUsd += cal.costUsd;
      const rows = cal.judges.map((j) => `${j.kind}: ${Math.round(j.accuracy * 100)}% agree${j.inflation ? `, over-scores bad items by ${j.inflation}` : ""}`);
      const dis = cal.disagreements.map((x) => `${x.kind} “${x.item}” labeled ${x.label}, judge gave ${x.got}`);
      say(run, cal.disagreements.length ? "error" : "agent", `Judge calibration ($${cal.costUsd.toFixed(3)}): ${rows.join("; ") || "no verdicts"}.${dis.length ? ` Disagreements: ${dis.join("; ")}. Later scores from this judge are reduced by its inflation.` : " No disagreements with the golden labels."}`);
    },
  };
}
