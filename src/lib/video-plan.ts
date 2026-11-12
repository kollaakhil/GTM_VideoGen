import { chatJSON, generateImage, type Part } from "./ai";
import type { Brief, Direction, Research, Shot, ShotQA, StyleDNA, VideoCategory, VideoPlan } from "./types";

export const QA_PASS = 8;

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

/** Shot lengths a clip model can render (clamped later to the model's supported durations). */
const shotSeconds = (lengthSec: number, n: number) => Math.max(3, Math.min(8, Math.round(lengthSec / n)));

export async function planShots(
  model: string,
  d: Direction,
  b: Brief,
  r: Research,
  plan: VideoPlan,
  style?: StyleDNA | null,
): Promise<{ shots: Shot[]; cost: number }> {
  const cat = CATEGORIES[plan.category];
  const n = Math.max(2, Math.min(cat.beats.length, Math.round(plan.lengthSec / 4)));
  const beats = n >= cat.beats.length ? cat.beats : [cat.beats[0], ...cat.beats.slice(1, n - 1), "cta"];
  const secs = shotSeconds(plan.lengthSec, beats.length);
  const { data, usage } = await chatJSON<{ shots: { beat: string; visual: string; camera: string; vo: string }[] }>(
    model,
    "You are a performance-ad director storyboarding a vertical 9:16 video ad. You write shot lists that AI video models render well.",
    `Direction: ${JSON.stringify({ title: d.title, hook: d.hook, angle: d.angle, script: d.script })}
Brief: ${JSON.stringify(b)}
Brand tone: ${r.tone}
Category: ${cat.label}. Look: ${cat.look}. Voice: ${cat.voice}.${style ? `\nBorrowed style: ${style.tone}; ${style.visualLanguage}; pacing ${style.pacing}. Never use ${style.brand}'s name, logo or slogans.` : ""}
Write exactly ${beats.length} shots, beats in order: ${beats.join(", ")}. Each shot is ${secs}s.
Rules:
- Shot 1 must stop the scroll in the first second and show the product or the core tension immediately.
- "visual": one concrete, filmable scene (subject, action, setting, light, palette). Same product appearance and same people across shots for continuity.
- Never put text, signs, captions, labels, price tags, logos or UI in frame; all text is added in post.
- "camera": one camera move (e.g. slow push-in, handheld follow, top-down static, orbit).
- "vo": the words spoken over this shot only, at most ${Math.round(secs * 2.3)} words, natural speech, only facts from the brief. The last shot ends on the call to action.
Return JSON: {"shots":[{"beat","visual","camera","vo"}]}`,
  );
  const shots = data.shots.slice(0, beats.length).map((s, i) => ({ id: `s${i}`, beat: s.beat || beats[i], seconds: secs, visual: s.visual, camera: s.camera, vo: s.vo, status: "planned" as const }));
  return { shots, cost: usage.costUsd };
}

export function keyframePrompt(s: Shot, cat: VideoCategory, colors: string[] = []) {
  return `Vertical 9:16 photoreal still frame for a video ad (${CATEGORIES[cat].label}). ${s.visual} Camera: ${s.camera}. Look: ${CATEGORIES[cat].look}.${colors.length ? ` Palette accents: ${colors.slice(0, 3).join(", ")}.` : ""}
Absolutely no text, letters, numbers, signs, labels, price tags or logos anywhere. Keep the main subject inside the center 70% of the frame. If a product photo is attached, the product must match it exactly (shape, color, material, proportions).`;
}

export async function keyframe(imageModel: string, s: Shot, cat: VideoCategory, refs: string[], colors?: string[], fixes?: string[]) {
  const prompt = keyframePrompt(s, cat, colors) + (fixes?.length ? `\nFix these issues from the last version: ${fixes.join(" ")}` : "");
  return generateImage(imageModel, prompt, refs.slice(0, 2));
}

/** Vision QA for a storyboard keyframe or a clip contact sheet. Compares against the product photo when given. */
export async function shotQA(visionModel: string, image: string, s: Shot, kind: "keyframe" | "clip", productRef?: string): Promise<{ qa: ShotQA; cost: number }> {
  const content: Part[] = [
    {
      type: "text",
      text: `You are a strict creative director reviewing a ${kind === "clip" ? "contact sheet of frames from one video shot (left to right = time)" : "storyboard keyframe"} for a vertical video ad.
Intended shot: ${s.visual} Camera: ${s.camera}. Beat: ${s.beat}.${productRef ? "\nThe second image is the real product photo: the product in the frame must match it." : ""}
Score 1-10. Deduct hard for: any text, letters, logos or price tags in frame (should be none); garbled or warped objects, hands or faces; product not matching the reference; weak focal point; subject outside the 9:16 safe area; not matching the intended shot${kind === "clip" ? "; flicker, morphing, identity drift or frozen motion between frames" : ""}.
You only see frames, not audio. Return JSON: {"score": number, "notes": string[] (max 4, each a specific fix)}`,
    },
    { type: "image_url", image_url: { url: image } },
    ...(productRef ? [{ type: "image_url" as const, image_url: { url: productRef } }] : []),
  ];
  const { data, usage } = await chatJSON<ShotQA>(visionModel, "Return only JSON.", content);
  return { qa: { score: Math.max(0, Math.min(10, Number(data.score) || 0)), notes: (data.notes ?? []).slice(0, 4) }, cost: usage.costUsd };
}

/** Rough pre-flight cost so the user sees the bill before spending. */
export function estimateCost(plan: VideoPlan, shots: number, stage: "storyboard" | "video") {
  if (stage === "storyboard") return +(shots * 0.06 + 0.02).toFixed(2);
  const perSec = /veo-3\.1(?!-fast|-lite)|kling-v3\.0-pro|seedance-2\.0$|hailuo-3$/.test(plan.finalModel) ? 0.4 : 0.1;
  const audio = 0.02 + (plan.music ? 0.6 : 0);
  return +(plan.lengthSec * perSec * 1.5 + shots * 0.01 + audio).toFixed(2);
}
