import { randomUUID } from "node:crypto";
import { brandRules } from "@/lib/brand-rules";
import { applyScriptEdit, checkScript, draftHooks, judgeFor, proofAssetUrl, reviewHooks, reviewScript, scriptChanged, scriptLab, scriptSeconds, scriptText, WRITER, writerLabel } from "@/lib/script-lab";
import { preflightScript } from "@/lib/gate";
import { styleLabel } from "@/lib/script-styles";
import { hasIndependentScriptReview, scriptProductionBlocker } from "@/lib/quality-policy";
import { storeMedia } from "@/lib/store";
import type { AdScript, Direction, ScriptProofBrief, StudioRun } from "@/lib/types";
import { Ref } from "../schema";
import { say, live, saveRun } from "../run-state";
import { brandFor, guidance, swipesFor } from "../context";
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
  if (body.style) run.scriptStyle = body.style;
  return {
    activity: `Hook Lab: drafting and reviewing three openings for “${d.title}”…`,
    work: async () => {
      const evidence = savedAsset ?? external ?? (photo && asset ? await storeMedia(asset, `${run.id}/proof-${randomUUID()}`) : undefined);
      const proof: ScriptProofBrief = { ...fields, ...(evidence ? { asset: evidence } : {}), quote };
      const lab: NonNullable<Direction["hookLab"]> = { id: randomUUID(), brief: proof, hooks: [], writer, lengthSec: body.lengthSec };
      d.hookLab = lab;
      run.job = { directionId: d.id, label: "Drafting distinct openings", done: 0, total: 2 };
      await saveRun(run);
      const c = { direction: d, brief: run.brief!, research: run.research!, voc: run.voc, style: run.styleDNA, lengthSec: body.lengthSec, proof, scriptStyle: run.scriptStyle, swipes: await swipesFor(run) };
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
  if (body.style) run.scriptStyle = body.style;
  return {
    activity: `Script Lab: ${writerLabel(writer)} writes from the chosen opening; ${writerLabel(judge)} reviews…`,
    work: async () => {
      run.job = { directionId: d.id, label: "Writing, rehearsing and reviewing the script", done: 0, total: 1 };
      const [kit, rules, swipes] = await Promise.all([brandFor(run), guidance(run), swipesFor(run)]);
      const r = await scriptLab({ direction: d, brief: run.brief!, research: run.research!, voc: run.voc, style: run.styleDNA, rules, mustSay: kit?.mustSay, lengthSec: body.lengthSec, proof: lab.brief, scriptStyle: run.scriptStyle, swipes }, hook, writer, judge);
      run.costUsd += r.cost;
      const script = await withClaimsPreflight(run, d, r.script);
      lab.selectedId = hook.id;
      d.scripts = [script, ...(d.scripts ?? [])].slice(0, 3);
      say(run, "agent", `Your ${run.scriptStyle && run.scriptStyle !== "auto" ? `${styleLabel(run.scriptStyle)} ` : ""}draft and score are ready.${script.claimFlags?.length ? ` The claims check flagged ${script.claimFlags.length} line${script.claimFlags.length === 1 ? "" : "s"}; edit them before approving.` : ""} Edit any line, re-score, then approve the script you want to use.`);
    },
  };
}

export async function planApproveScript(run: StudioRun, body: ActionBody<"approve_script">): Promise<Job> {
  const d = run.directions.find((x) => x.id === body.directionId);
  const sc = d?.scripts?.find((x) => x.id === body.scriptId);
  if (!d || !sc) return { error: "Script not found" };
  return {
    activity: `Saving script approval for “${d.title}”…`,
    work: async () => {
      let next = applyScriptEdit(sc, body.edit);
      const changed = scriptChanged(next, sc);
      const kit = await brandFor(run);
      const targetSeconds = sc.review?.targetSeconds ?? run.videoPlan?.lengthSec ?? scriptSeconds(next);
      next.checks = checkScript(next, targetSeconds, kit?.mustSay);
      if (changed) {
        next.score = undefined;
        next.review = undefined;
        next.gate = undefined;
        next = await withClaimsPreflight(run, d, next);
      }
      const saveApproval = () => {
        d.scripts = d.scripts!.map((s) => s.id === sc.id ? next : s);
        d.approvedScript = next;
        d.script = scriptText(next);
        d.hook = next.hook.spoken;
      };
      if (changed || d.approvedScript?.id !== sc.id) Object.assign(d, { shots: undefined, passingDraft: null, storyboardKey: null });
      saveApproval();
      if (!next.checks?.length && !hasIndependentScriptReview(next)) {
        await saveRun(run);
        if (!run.brief || !run.research) throw new Error("Brand research and a brief are required to review this script.");
        const result = await reviewScript(next, { direction: d, brief: run.brief, research: run.research, voc: run.voc, style: run.styleDNA, rules: brandRules(kit), mustSay: kit?.mustSay, lengthSec: targetSeconds, proof: next.proofBrief, scriptStyle: next.style ?? run.scriptStyle, swipes: await swipesFor(run) }, sc.review?.writer ?? WRITER, sc.review?.judge);
        next = { ...result.script, claimFlags: next.claimFlags };
        run.costUsd += result.cost;
        saveApproval();
      }
      const blocker = scriptProductionBlocker(next);
      say(run, "agent", blocker ? `Script approved. Build its storyboard now. Before upgrading to HD: ${blocker}` : "Script approved. Build its storyboard next.");
    },
  };
}

/** Claims preflight on every script line and the ad's body copy; flags script lines and rewrites flagged body copy. */
async function withClaimsPreflight(run: StudioRun, d: Direction, script: AdScript): Promise<AdScript> {
  const model = run.models?.text;
  if (!run.research || !run.brief || !model) return script;
  const pf = await preflightScript(model, { script, copy: d.copy, research: run.research, brief: run.brief, offerTerms: run.offer }).catch(() => null);
  if (!pf) return script;
  run.costUsd += pf.cost;
  if (pf.copy) d.copy = pf.copy;
  for (const c of pf.changes) say(run, "agent", `“${d.title}”: ${c}.`);
  return { ...script, claimFlags: pf.flags };
}

/** Re-checks and re-scores one script after operator edits (hook, any beat, CTA) without approving it. */
export async function planRescoreScript(run: StudioRun, body: ActionBody<"rescore_script">): Promise<Job> {
  const d = run.directions.find((x) => x.id === body.directionId);
  const sc = d?.scripts?.find((x) => x.id === body.scriptId) ?? (d?.approvedScript?.id === body.scriptId ? d.approvedScript : undefined);
  if (!d || !sc) return { error: "Script not found" };
  if (!run.brief || !run.research) return { error: "Brand research and a brief are required to review this script." };
  return {
    activity: `Re-checking and re-scoring the edited script for “${d.title}”…`,
    work: async () => {
      const edited = applyScriptEdit(sc, body.edit);
      const changed = scriptChanged(edited, sc);
      const [kit, swipes] = await Promise.all([brandFor(run), swipesFor(run)]);
      const targetSeconds = sc.review?.targetSeconds ?? run.videoPlan?.lengthSec ?? scriptSeconds(edited);
      const checked = await withClaimsPreflight(run, d, edited);
      const c = { direction: d, brief: run.brief!, research: run.research!, voc: run.voc, style: run.styleDNA, rules: brandRules(kit), mustSay: kit?.mustSay, lengthSec: targetSeconds, proof: edited.proofBrief, scriptStyle: edited.style ?? run.scriptStyle, swipes };
      // Only an edited script may carry its earlier scores forward when Jev passes it; a plain re-score always pays for the judge.
      const prior = changed && hasIndependentScriptReview(sc) ? sc : null;
      const r = await reviewScript(checked, c, sc.review?.writer ?? WRITER, sc.review?.judge, { prior });
      run.costUsd += r.cost;
      const next: AdScript = { ...r.script, claimFlags: checked.claimFlags };
      d.scripts = (d.scripts ?? []).some((s) => s.id === sc.id) ? d.scripts!.map((s) => s.id === sc.id ? next : s) : [next, ...(d.scripts ?? [])].slice(0, 3);
      const unapproved = changed && d.approvedScript?.id === sc.id;
      if (d.approvedScript?.id === sc.id) {
        if (changed) Object.assign(d, { approvedScript: null, shots: undefined, passingDraft: null, storyboardKey: null });
        else d.approvedScript = next;
      }
      const flags = [...(next.claimFlags ?? []).map((f) => `${f.where}: ${f.claim}`), ...(next.checks ?? [])];
      const gate = next.gate ? (next.gate.skippedJudge ? " Jev pre-check passed, so the full judge was skipped." : " Jev pre-check escalated to the full judge.") : "";
      say(run, flags.length ? "error" : "agent", `Re-scored: ${next.score?.overall ?? "?"}/10.${gate}${flags.length ? ` Fix before approving: ${flags.slice(0, 3).join(" · ")}` : " Approve it when you're happy."}${unapproved ? " Your edit cleared the earlier approval." : ""}`);
    },
  };
}
