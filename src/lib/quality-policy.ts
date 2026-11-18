import type { AdScript, Creative, Direction, ScriptHook, Shot, VideoPlan, VideoQuality } from "./types";

export const VIDEO_PASS = 9;
export const SCRIPT_RUBRIC = "studio-script-v2";
export const videoAspects = (tier: VideoQuality["tier"]) => tier === "final" ? ["9:16", "4:5", "1:1"] as const : ["9:16"] as const;

export function hasIndependentScriptReview(s?: AdScript | null) {
  return !!s?.review && !!s.score && s.review.writer !== s.review.judge &&
    (s.review.rubric === SCRIPT_RUBRIC || s.review.rubric === "studio-script-v1");
}

export function scriptProductionBlockers(s?: AdScript | null): string[] {
  if (!s) return ["Approve a script first."];
  const blockers = new Set([
    ...(s.checks ?? []),
    ...(s.score?.unsupported.map((claim) => `Unsupported claim: ${claim}`) ?? []),
    ...(s.score?.proofProblems ?? []),
    ...(s.claimFlags?.map((f) => `Unsupported claim in ${f.where}: ${f.claim}`) ?? []),
  ]);
  if (!blockers.size && (!hasIndependentScriptReview(s) || !s.checks)) {
    blockers.add("The script needs an independent production check.");
  }
  return [...blockers];
}

export const scriptProductionBlocker = (s?: AdScript | null) => scriptProductionBlockers(s)[0] ?? null;
export const scriptReady = (s?: AdScript | null) => scriptProductionBlocker(s) === null;

export function recommendedOpening(hooks: ScriptHook[]) {
  return hooks.filter((h) => h.review?.blockers.length === 0)
    .reduce<ScriptHook | undefined>((best, h) => !best || h.review!.score > best.review!.score ? h : best, undefined);
}

export function approvedStoryboardLength(d: Direction) {
  const s = d.approvedScript;
  if (d.format !== "video" || !s?.beats.length) return undefined;
  const length = s.review?.targetSeconds ?? s.beats.reduce((total, beat) => total + beat.seconds, 0);
  return Number.isInteger(length) && length >= 4 && length <= 60 ? length : undefined;
}

export function storyboardTargets(directions: Direction[], lengthSec?: number) {
  return directions.filter((d) => {
    const length = approvedStoryboardLength(d);
    return length !== undefined && (lengthSec === undefined || length === lengthSec);
  });
}

export const PRODUCT_PHOTO_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export function storyboardProofPhoto(runId: string, d: Direction) {
  const asset = d.approvedScript?.proofBrief?.asset;
  return asset && (asset.startsWith(`/api/media/${runId}/proof-`) || PRODUCT_PHOTO_PATTERN.test(asset)) ? asset : undefined;
}

export const shotReady = (q?: Shot["clipQa"] | null) => !!q && q.score >= VIDEO_PASS && q.match === "pass" &&
  !!q.frames?.length && q.frames.every((f) => f.match === "pass");

export function storyboardKeyframeFixes(shots: Shot[]) {
  return shots.flatMap((s, index) => s.keyframe && shotReady(s.keyframeQa) ? [] : [index + 1]);
}

export function draftVideoBlocker(d: Direction, plan?: VideoPlan | null) {
  if (!approvedStoryboardLength(d)) return "Approve a video script first.";
  if (!plan || !d.storyboardKey || !d.shots?.length || d.shots.some((s) => !s.keyframe)) {
    return "Build a complete storyboard with keyframes before generating a draft.";
  }
  if (!d.productRefs?.length) return "Rebuild the storyboard with real product references.";
  return null;
}

export const videoReady = (q?: VideoQuality | null) => !!q && q.status === "pass" && q.score >= VIDEO_PASS &&
  !q.findings.length && !!q.shots.length && q.shots.every((s) => shotReady(s.qa)) &&
  videoAspects(q.tier).every((a) => q.aspects.includes(a));

export function strictVideoBlock(c: Pick<Creative, "mediaType" | "quality">) {
  if (c.mediaType !== "video") return null;
  if (!videoReady(c.quality)) return "This video needs a passing 9/10 export QA report.";
  if (c.quality?.tier !== "final") return "Upgrade the passing draft to HD and verify the HD export first.";
  if (!c.quality.storyboardKey) return "Reverify the video against its locked storyboard.";
  return null;
}

export function videoPublishBlock(c: Creative, currentStoryboard?: string | null) {
  const reason = strictVideoBlock(c);
  if (reason || c.mediaType !== "video") return reason;
  if (c.quality?.storyboardKey !== currentStoryboard) return "The storyboard changed. Render and verify the current version before publishing.";
  if (c.status === "rejected" || !c.qa?.pass || !c.gate?.pass) return "The current video must pass the Creative Director Gate before publishing.";
  return null;
}
