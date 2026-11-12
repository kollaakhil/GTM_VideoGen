import { chatJSON, generateImage, type Part } from "./ai";
import { CATEGORIES } from "./video-categories";
import type { Brief, Direction, Research, Shot, ShotQA, StyleDNA, VideoCategory, VideoPlan } from "./types";

export { CATEGORIES, estimateCost } from "./video-categories";

export const QA_PASS = 8;

/** Shot lengths a clip model can render (clamped later to the model's supported durations). */
const shotSeconds = (lengthSec: number, n: number) => Math.max(3, Math.min(8, Math.round(lengthSec / n)));

export async function planShots(
  model: string,
  d: Direction,
  b: Brief,
  r: Research,
  plan: VideoPlan,
  style?: StyleDNA | null,
  examples: { beat: string; visual: string; camera: string; score: number }[] = [],
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
${examples.length ? `Shots that scored 8+ in this category before (borrow what made them render well: framing, light, motion; never their content):\n${examples.map((e) => `- ${e.beat}: ${e.visual} (${e.camera}) [${e.score}/10]`).join("\n")}\n` : ""}Write exactly ${beats.length} shots, beats in order: ${beats.join(", ")}. Each shot is ${secs}s.
Rules:
- Shot 1 must stop the scroll in the first second and show the product or the core tension immediately.
- "visual": one concrete, filmable scene (subject, action, setting, light, palette). Same product appearance and same people across shots for continuity.
- Never put text, signs, captions, labels, price tags, logos or UI in frame; all text is added in post.
- "camera": one gentle camera move (e.g. slow push-in, slow pan, top-down static, slight orbit). Keep every person and the product fully in frame for the whole shot; never push in so far that anyone is cropped out.
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
Score 1-10. Anchors: 8 = usable as is with only minor polish notes; 6-7 = a visible defect most viewers would notice; 1-5 = broken. Taste-level suggestions alone never pull a score below 8. Deduct hard for: any text, letters, logos or price tags in frame (should be none); garbled or warped objects, hands or faces; product not matching the reference; weak focal point; subject outside the 9:16 safe area; not matching the intended shot${kind === "clip" ? "; flicker, morphing, identity drift or frozen motion between frames" : ""}.
You only see frames, not audio. Return JSON: {"score": number, "notes": string[] (max 4, each a specific fix)}`,
    },
    { type: "image_url", image_url: { url: image } },
    ...(productRef ? [{ type: "image_url" as const, image_url: { url: productRef } }] : []),
  ];
  const { data, usage } = await chatJSON<ShotQA>(visionModel, "Return only JSON.", content);
  return { qa: { score: Math.max(0, Math.min(10, Number(data.score) || 0)), notes: (data.notes ?? []).slice(0, 4) }, cost: usage.costUsd };
}

