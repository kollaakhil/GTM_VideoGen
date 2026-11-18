import { randomUUID } from "node:crypto";
import { brandRules } from "@/lib/brand-rules";
import { checkScript, draftHooks, judgeFor, proofAssetUrl, reviewHooks, reviewScript, scriptLab, scriptSeconds, scriptText, WRITER, writerLabel } from "@/lib/script-lab";
import { hasIndependentScriptReview, scriptProductionBlocker } from "@/lib/quality-policy";
import { storeMedia } from "@/lib/store";
import type { Direction, ScriptProofBrief, StudioRun } from "@/lib/types";
import { Ref } from "../schema";
import { say, live, saveRun } from "../run-state";
import { brandFor, guidance } from "../context";
import type { Job, ActionBody } from "./types";

export async function planDraftHooks(run: StudioRun, body: ActionBody<"draft_hooks">): Promise<Job> {
  const d = run.directions.find((x) => x.id === body.directionId && x.format === "video");
  if (!run.brief || !run.research || !d) return { error: "Pitch a video direction first." };
  const { asset, quoteIndex, ...fields } = body.proof;
  const savedAsset = d.hookLab?.brief.asset === asset && asset?.startsWith("/api/media/") ? asset : null;
  const photo = Ref.safeParse(asset).success;
  const external = asset?.startsWith("https://") ? proofAssetUrl(asset) : null;
  if (asset && !photo && !external && !savedAsset) return { error: "Leave the optional asset blank or use a product photo or HTTPS link." };
  if (![...run.research.valueProps, ...(run.offer?.split("\n") ?? [])].some((fact) => fact.trim() === fields.claim)) return { error: "Choose a claim from this run’s saved product facts." };
  const quote = quoteIndex === undefined ? undefined : run.voc?.sourcedQuotes?.[quoteIndex];
  if (quoteIndex !== undefined && !quote) return { error: "Select a sourced customer quote or leave it blank." };
  const writer = body.writer ?? WRITER;
  const judge = judgeFor(writer, body.judge);
  return {
    activity: `Hook Lab: drafting and reviewing three openings for “${d.title}”…`,
    work: async () => {
      const evidence = savedAsset ?? external ?? (photo && asset ? await storeMedia(asset, `${run.id}/proof-${randomUUID()}`) : undefined);
      const proof: ScriptProofBrief = { ...fields, ...(evidence ? { asset: evidence } : {}), quote };
      const lab: NonNullable<Direction["hookLab"]> = { id: randomUUID(), brief: proof, hooks: [], writer, lengthSec: body.lengthSec };
      d.hookLab = lab;
      run.job = { directionId: d.id, label: "Drafting distinct openings", done: 0, total: 2 };
      await saveRun(run);
      const c = { direction: d, brief: run.brief!, research: run.research!, voc: run.voc, style: run.styleDNA, lengthSec: body.lengthSec, proof };
      const drafts = await draftHooks(writer, c, () => {
        if (!live(run)) throw new Error("Stopped before retrying missing openings.");
      });
      run.costUsd += drafts.cost;
      if (!drafts.hooks.length) throw new Error(`No usable openings after one repair attempt. ${drafts.issues.join(" ")} The proof brief is saved; retry Draft openings.`);
      run.job = { directionId: d.id, label: "Reviewing openings independently", done: 1, total: 2 };
      await saveRun(run);
      const reviewed = await reviewHooks(judge, c, drafts.hooks);
      run.costUsd += reviewed.cost;
      lab.hooks = reviewed.hooks;
      const partial = reviewed.hooks.length < 3 ? `Only ${reviewed.hooks.length} of 3 openings met the format and timing checks after one repair attempt. ` : "";
      say(run, "agent", partial + (reviewed.hooks.every((h) => h.review.blockers.length) ? "Every reviewed opening has a blocker. Check the notes and revise the proof brief before trying again." : "The best reviewed opening is ready. Click Write script to use it, or see the alternatives."));
    },
  };
}

export async function planWriteScripts(run: StudioRun, body: ActionBody<"write_scripts">): Promise<Job> {
  const d = run.directions.find((x) => x.id === body.directionId && x.format === "video");
  if (!run.brief || !run.research || !d) return { error: "Pitch a video direction first." };
  const lab = d.hookLab;
  const hook = lab?.hooks.find((h) => h.id === body.hookId);
  if (!lab || !hook?.review || hook.review.blockers.length) return { error: "Select a reviewed opening with no blockers first." };
  if (lab.lengthSec !== body.lengthSec) return { error: "Rebuild the openings for the current video duration." };
  const writer = body.writer ?? WRITER;
  const judge = judgeFor(writer, body.judge);
  return {
    activity: `Script Lab: ${writerLabel(writer)} writes from the chosen opening; ${writerLabel(judge)} reviews…`,
    work: async () => {
      run.job = { directionId: d.id, label: "Writing, rehearsing and reviewing the script", done: 0, total: 1 };
      const [kit, rules] = await Promise.all([brandFor(run), guidance(run)]);
      const r = await scriptLab({ direction: d, brief: run.brief!, research: run.research!, voc: run.voc, style: run.styleDNA, rules, mustSay: kit?.mustSay, lengthSec: body.lengthSec, proof: lab.brief }, hook, writer, judge);
      lab.selectedId = hook.id;
      d.scripts = [r.script, ...(d.scripts ?? [])].slice(0, 3);
      run.costUsd += r.cost;
      say(run, "agent", "Your draft and score are ready. Approve the script you want to use.");
    },
  };
}

export async function planApproveScript(run: StudioRun, body: ActionBody<"approve_script">): Promise<Job> {
  const d = run.directions.find((x) => x.id === body.directionId);
  const sc = d?.scripts?.find((x) => x.id === body.scriptId);
  if (!d || !sc) return { error: "Script not found" };
  if (sc.proofBrief && ((body.edit?.hook !== undefined && body.edit.hook !== sc.hook.spoken) ||
    (body.edit?.cta !== undefined && body.edit.cta !== sc.cta) ||
    (body.edit?.beats?.[0] && (body.edit.beats[0].vo !== sc.hook.spoken || body.edit.beats[0].onScreen !== sc.hook.onScreen)))) {
    return { error: "The opening and CTA are locked. Pick another hook or revise the proof brief instead." };
  }
  return {
    activity: `Saving script approval for “${d.title}”…`,
    work: async () => {
      let next = structuredClone(sc);
      if (body.edit?.hook !== undefined && next.beats[0]) next.beats[0].vo = body.edit.hook;
      if (body.edit?.cta !== undefined) next.cta = body.edit.cta;
      body.edit?.beats?.forEach((b, i) => {
        if (next.beats[i]) Object.assign(next.beats[i], b);
      });
      if (body.edit && next.beats[0]) Object.assign(next.hook, { spoken: next.beats[0].vo, onScreen: next.beats[0].onScreen });
      const changed = JSON.stringify([next.hook, next.beats, next.cta]) !== JSON.stringify([sc.hook, sc.beats, sc.cta]);
      const kit = await brandFor(run);
      const targetSeconds = sc.review?.targetSeconds ?? run.videoPlan?.lengthSec ?? scriptSeconds(next);
      next.checks = checkScript(next, targetSeconds, kit?.mustSay);
      if (changed) {
        next.score = undefined;
        next.review = undefined;
      }
      const saveApproval = () => {
        d.scripts = d.scripts!.map((s) => s.id === sc.id ? next : s);
        d.approvedScript = next;
        d.script = scriptText(next);
        d.hook = next.hook.spoken;
      };
      if (changed || d.approvedScript?.id !== sc.id) Object.assign(d, { shots: undefined, passingDraft: null, storyboardKey: null });
      saveApproval();
      if (!next.checks.length && !hasIndependentScriptReview(next)) {
        await saveRun(run);
        if (!run.brief || !run.research) throw new Error("Brand research and a brief are required to review this script.");
        const result = await reviewScript(next, { direction: d, brief: run.brief, research: run.research, voc: run.voc, style: run.styleDNA, rules: brandRules(kit), mustSay: kit?.mustSay, lengthSec: targetSeconds, proof: sc.proofBrief }, sc.review?.writer ?? WRITER, sc.review?.judge);
        next = result.script;
        run.costUsd += result.cost;
        saveApproval();
      }
      const blocker = scriptProductionBlocker(next);
      say(run, "agent", blocker ? `Script approved. Build its storyboard now. Before upgrading to HD: ${blocker}` : "Script approved. Build its storyboard next.");
    },
  };
}
