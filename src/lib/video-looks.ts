import type { Shot, VideoPlan } from "./types";

/** Lens choices for the Video plan. "auto" lets the storyboard pick per shot. */
export const LENSES = {
  auto: { label: "Auto (per shot)", prompt: "" },
  wide24: { label: "24mm wide", prompt: "24mm wide-angle lens, deep focus, the whole setting visible" },
  std35: { label: "35mm documentary", prompt: "35mm lens at eye level, natural perspective, subject and setting both readable" },
  normal50: { label: "50mm natural", prompt: "50mm lens, natural perspective, gentle background falloff" },
  portrait85: { label: "85mm portrait", prompt: "85mm portrait lens, shallow depth of field, creamy background blur" },
  macro100: { label: "100mm macro", prompt: "100mm macro lens, close product detail, very shallow depth of field" },
} as const;
export type LensId = keyof typeof LENSES;

/** Visual styles: a grade and lighting recipe added to every keyframe and clip prompt. */
export const VISUAL_STYLES = {
  natural: { label: "Natural", prompt: "" },
  bright: { label: "Bright commercial", prompt: "bright, clean commercial lighting, high key, crisp whites, saturated brand accents" },
  cinematic: { label: "Cinematic film", prompt: "cinematic film grade, soft contrast, warm highlights, subtle film grain, motivated practical light" },
  moody: { label: "Moody low-key", prompt: "low-key moody lighting, deep shadows, single soft key light, rich blacks" },
  documentary: { label: "Documentary", prompt: "documentary realism, available light, honest textures, true-to-life color" },
  minimal: { label: "Minimal pastel", prompt: "minimal set, soft pastel palette, diffused daylight, lots of negative space" },
} as const;
export type VisualStyleId = keyof typeof VISUAL_STYLES;

/** Music beds: the prompt sent to the music model. "auto" follows the ad category and brand tone. */
export const MUSIC_STYLES = {
  auto: { label: "Auto (fits category)", prompt: "" },
  upbeat: { label: "Upbeat pop", prompt: "upbeat modern pop groove, bright synths, light percussion" },
  lofi: { label: "Lo-fi chill", prompt: "mellow lo-fi hip hop beat, warm keys, soft vinyl texture" },
  cinematic: { label: "Cinematic swell", prompt: "cinematic orchestral swell, gentle strings building to a lift" },
  acoustic: { label: "Warm acoustic", prompt: "warm acoustic guitar and light claps, feel-good folk" },
  electronic: { label: "Electronic pulse", prompt: "minimal electronic pulse, tight kick, confident and modern" },
} as const;
export type MusicStyleId = keyof typeof MUSIC_STYLES;

export const LENS_IDS = Object.keys(LENSES) as [LensId, ...LensId[]];
export const VISUAL_STYLE_IDS = Object.keys(VISUAL_STYLES) as [VisualStyleId, ...VisualStyleId[]];
export const MUSIC_STYLE_IDS = Object.keys(MUSIC_STYLES) as [MusicStyleId, ...MusicStyleId[]];

const pick = <T extends Record<string, { prompt: string }>>(table: T, id: string | undefined | null) => (id && id in table ? table[id as keyof T].prompt : "");

/** Lens and grade for one shot: the shot's own lens wins over the plan default. */
export function lookLine(plan: Pick<VideoPlan, "lens" | "visualStyle"> | null | undefined, s?: Pick<Shot, "lens"> | null) {
  const lens = pick(LENSES, s?.lens && s.lens !== "auto" ? s.lens : plan?.lens);
  const style = pick(VISUAL_STYLES, plan?.visualStyle);
  return [lens && `Lens: ${lens}.`, style && `Grade: ${style}.`].filter(Boolean).join(" ");
}

/** Music prompt for the plan: the chosen style, or a clean bed that fits the category and tone. */
export function musicPrompt(plan: Pick<VideoPlan, "musicStyle">, categoryLabel: string, tone?: string | null) {
  const style = pick(MUSIC_STYLES, plan.musicStyle);
  return style
    ? `Instrumental ${style}, for a ${categoryLabel} ad, ${tone ?? "modern"} tone, no vocals, steady energy under a voiceover.`
    : `Clean instrumental for a ${categoryLabel}, ${tone ?? "modern"} tone, no vocals.`;
}
