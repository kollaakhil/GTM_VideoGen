import type { VideoCategory, VideoPlan } from "./types";

/** Video plan defaults shared by the Studio form and the storyboard action. */
export const DEFAULT_VIDEO_PLAN: VideoPlan = { category: "product_demo", lengthSec: 10, draftModel: "hfmcp:seedance1_5", finalModel: "hfmcp:kling3_0", voice: "Rachel", music: true, budgetUsd: 3 };

/** Shot recipes per ad category: the beat order and the look each category is known for. */
export const CATEGORIES: Record<VideoCategory, { label: string; beats: string[]; look: string; voice: string }> = {
  product_demo: { label: "Product demo", beats: ["hook", "feature", "feature", "result", "cta"], look: "clean studio or real-use setting, macro detail shots, hands using the product, smooth gimbal moves", voice: "confident, clear" },
  ugc_testimonial: { label: "UGC testimonial", beats: ["hook", "problem", "discovery", "proof", "cta"], look: "handheld phone selfie footage, natural window light, real home setting, person talking to camera", voice: "casual, first-person, authentic" },
  cinematic_lifestyle: { label: "Cinematic lifestyle", beats: ["hook", "world", "product moment", "payoff", "cta"], look: "cinematic 35mm look, shallow depth of field, golden-hour light, slow dolly and push-ins", voice: "warm, aspirational" },
  motion_graphics: { label: "Motion graphics", beats: ["hook", "point", "point", "proof", "cta"], look: "bold flat color fields, product cutouts on solid backgrounds, kinetic camera moves, graphic shapes, no people", voice: "punchy, upbeat" },
  unboxing: { label: "Unboxing", beats: ["hook", "unbox", "reveal", "detail", "cta"], look: "top-down and 45-degree tabletop, hands opening packaging, satisfying reveal, soft daylight", voice: "excited, conversational" },
  before_after: { label: "Before / after", beats: ["hook", "before", "switch", "after", "cta"], look: "same framing for before and after, desaturated before, vibrant after, match-cut transition", voice: "matter-of-fact, relieved" },
  problem_solution: { label: "Problem / solution", beats: ["hook", "problem", "agitate", "solution", "cta"], look: "relatable everyday frustration, then the product fixing it in one clear action", voice: "empathetic, then upbeat" },
  founder_story: { label: "Founder story", beats: ["hook", "why", "how it's made", "proof", "cta"], look: "documentary style, founder at work, workshop or studio, natural light, intimate close-ups", voice: "personal, sincere" },
};

export const LENGTHS = [6, 10, 15, 20, 30];

/** Pre-flight cost: storyboard keyframes, or one pass of video at the model's real per-second price plus QA and audio. */
export function estimateCost(stage: "storyboard" | "video", o: { perSec?: number | null; lengthSec: number; shots: number; music?: boolean }) {
  if (stage === "storyboard") return +(o.shots * 0.08 + 0.02).toFixed(2);
  return +(o.lengthSec * (o.perSec ?? 0.12) + o.shots * 0.01 + 0.02 + (o.music ? 0.6 : 0)).toFixed(2);
}

export const shotCount = (lengthSec: number, category: VideoCategory) => Math.max(2, Math.min(CATEGORIES[category].beats.length, Math.round(lengthSec / 4)));
