import { brief } from "@/lib/pipeline";
import { aiConfigured } from "@/lib/ai";
import { better, briefGate, gateJudge } from "@/lib/stage-gates";
import { saveStage, stageBlock } from "@/lib/stage-policy";
import { latestCalibration } from "@/lib/judge-calibration";
import type { Brief, StudioRun } from "@/lib/types";

/**
 * Brief gate: rules + one cheap judge; under the bar the brief is rewritten once with the fix notes and the better
 * attempt is kept. Returns the brief, the total cost and a chat line. Demo mode (no AI) skips judging.
 */
export async function gatedBrief(run: StudioRun, model: string, goal: string): Promise<{ data: Brief; cost: number; line: string }> {
  const first = await brief(model, run.research!, goal, run.styleDNA);
  if (!aiConfigured()) return { data: first.data, cost: first.cost, line: "" };
  const judge = gateJudge(run);
  const cal = await latestCalibration();
  let kept = first.data;
  let cost = first.cost;
  let gate = await briefGate(judge, first.data, run.research!, goal, cal);
  if (!gate.score.pass && gate.fixes.length) {
    const again = await brief(model, run.research!, `${goal}\nFix these problems from the last brief: ${gate.fixes.slice(0, 6).join(" ")}`, run.styleDNA);
    cost += again.cost;
    const g2 = await briefGate(judge, again.data, run.research!, goal, cal, 2);
    if (g2.score.score >= gate.score.score) kept = again.data;
    gate = better(gate, g2);
  }
  cost += gate.cost;
  saveStage(run, gate.score);
  const blocked = stageBlock(run, "brief");
  return { data: kept, cost, line: blocked ? ` ${blocked} Top fixes: ${gate.fixes.slice(0, 2).join(" ")}` : ` Brief gate ${gate.score.score}/10.` };
}
