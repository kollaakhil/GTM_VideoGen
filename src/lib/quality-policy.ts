import type { AdScript, Creative, Shot, VideoQuality } from "./types";

export const SCRIPT_PASS = 9;
export const VIDEO_PASS = 9;
export const SCRIPT_RUBRIC = "studio-script-v1";
export const videoAspects = (tier: VideoQuality["tier"]) => tier === "final" ? ["9:16", "4:5", "1:1"] as const : ["9:16"] as const;

export function scriptReady(s?: AdScript | null) {
  return !!s?.review && s.review.rubric === SCRIPT_RUBRIC && s.review.writer !== s.review.judge &&
    !!s.score && s.score.overall >= SCRIPT_PASS && s.score.unsupported.length === 0 && s.checks?.length === 0;
}

export const shotReady = (q?: Shot["clipQa"] | null) => !!q && q.score >= VIDEO_PASS && q.match === "pass" &&
  !!q.frames?.length && q.frames.every((f) => f.match === "pass");

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
