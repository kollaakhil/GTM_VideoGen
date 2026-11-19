import { randomUUID } from "node:crypto";
import { storyboardProofPhoto, storyboardTargets } from "@/lib/quality-policy";
import { mediaDataUrl } from "@/lib/store";
import type { StudioRun } from "@/lib/types";
import { DEFAULT_VIDEO_PLAN } from "@/lib/video-categories";
import { say, saveRun } from "../run-state";
import { brandFor, saveStoryboardPhotos } from "../context";
import { makeKeyframe, storyboard } from "../video";
import type { Job, ActionBody } from "./types";

export async function planStoryboard(run: StudioRun, body: ActionBody<"storyboard">): Promise<Job> {
  if (!run.brief || !run.research || !run.directions.length) return { error: "Pitch directions first" };
  const p = body.plan;
  const all = body.directionId ? run.directions.filter((d) => d.id === body.directionId) : run.directions;
  if (!all.length) return { error: "Direction not found" };
  const approved = storyboardTargets(all);
  if (!approved.length) return { error: "Approve a video script with a valid duration before building its storyboard." };
  const targets = storyboardTargets(approved, p.lengthSec);
  if (!targets.length) return { error: `No script is approved for ${p.lengthSec}s. Build from its direction card to use the approved duration.` };
  const productRefs = body.refs?.length ? body.refs : run.storyboardPhotos?.length ? run.storyboardPhotos : (await brandFor(run))?.photos ?? [];
  const proofs = targets.map((d) => storyboardProofPhoto(run.id, d));
  if (!productRefs.length && proofs.some((photo) => !photo)) {
    return { error: "Add a real product photo in Video plan before building storyboards. A website link is not a product photo." };
  }
  run.videoPlan = {
    category: p.category,
    lengthSec: p.lengthSec,
    draftModel: p.draftModel ?? DEFAULT_VIDEO_PLAN.draftModel,
    finalModel: p.finalModel ?? DEFAULT_VIDEO_PLAN.finalModel,
    voice: p.voice ?? DEFAULT_VIDEO_PLAN.voice,
    music: p.music ?? DEFAULT_VIDEO_PLAN.music,
    budgetUsd: p.budgetUsd ?? DEFAULT_VIDEO_PLAN.budgetUsd,
    lens: p.lens ?? DEFAULT_VIDEO_PLAN.lens,
    visualStyle: p.visualStyle ?? DEFAULT_VIDEO_PLAN.visualStyle,
    musicStyle: p.musicStyle ?? DEFAULT_VIDEO_PLAN.musicStyle,
    takes: p.takes ?? DEFAULT_VIDEO_PLAN.takes,
    candidates: p.candidates ?? DEFAULT_VIDEO_PLAN.candidates,
    packshot: p.packshot ?? DEFAULT_VIDEO_PLAN.packshot,
    realSet: p.realSet ?? false,
  };
  return {
    activity: `Storyboarding ${targets.length === 1 ? `“${targets[0].title}”` : `${targets.length} directions`}: shot list, keyframes and keyframe QA…`,
    work: async () => {
      run.job = { label: "Planning shot lists", done: 0, total: 0 };
      const savedRefs = await saveStoryboardPhotos(run.id, productRefs);
      const shared = await Promise.all(productRefs.map((photo) => mediaDataUrl(photo)));
      if (body.refs?.length) run.storyboardPhotos = savedRefs;
      const res = await Promise.allSettled(targets.map(async (d, i) => {
        const asset = proofs[i];
        const refs = asset ? [await mediaDataUrl(asset), ...shared.slice(0, 3)] : shared;
        const saved = asset ? [asset, ...savedRefs.slice(0, 3)] : savedRefs;
        return storyboard(run, d, refs, saved);
      }));
      run.job = null;
      res.forEach((r, k) => {
        if (r.status === "rejected") {
          say(run, "error", `Storyboard for “${targets[k].title}” failed: ${String(r.reason?.message ?? r.reason).slice(0, 300)}`);
        }
      });
      const first = res[0];
      if (first?.status === "rejected" && res.every((r) => r.status === "rejected")) {
        throw new Error(String(first.reason?.message ?? first.reason).slice(0, 300));
      }
      say(run, "agent", "Storyboards are ready. Open Video controls to generate a 480p draft. Script and keyframe checks still apply to HD.");
    },
  };
}

export async function planRedoShot(run: StudioRun, body: ActionBody<"redo_shot">): Promise<Job> {
  const d = run.directions.find((x) => x.id === body.directionId);
  const s = d?.shots?.find((x) => x.id === body.shotId);
  if (!d || !s || !run.videoPlan || !d.storyboardKey || !d.approvedScript) return { error: "Build a storyboard for an approved script first." };
  return {
    activity: `Redrawing shot ${Number(s.id.slice(1)) + 1} of “${d.title}”…`,
    work: async () => {
      const productRefs = await Promise.all((d.productRefs ?? []).map(mediaDataUrl));
      if (!productRefs.length) throw new Error("The storyboard has no locked product references. Rebuild it.");
      d.storyboardKey = randomUUID();
      d.passingDraft = null;
      if (body.visual) s.visual = body.visual;
      s.keyframeQa = null;
      await saveRun(run);
      const verdict = await makeKeyframe(run, d, s, productRefs);
      say(run, "agent", `Redrew shot ${Number(s.id.slice(1)) + 1} (keyframe QA ${verdict.score}/10, ${verdict.match}).`);
    },
  };
}
