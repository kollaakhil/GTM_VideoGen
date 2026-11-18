import { createHash } from "node:crypto";
import { brandRules } from "@/lib/brand-rules";
import { learnings } from "@/lib/learnings";
import { get, list, storeMedia } from "@/lib/store";
import type { StudioRun } from "@/lib/types";

export const AUTO_FIX_ATTEMPTS = 2;

/** Static ads render this many takes per direction; vision QA keeps the best (cheap images, big quality gain). */
export const TOURNAMENT_SIZE = Math.max(1, Math.min(4, Number(process.env.TOURNAMENT_SIZE) || 2));

export const goalCtx = (run: StudioRun, extra = "") =>
  (run.offer ? `${run.goal}\nReal offer terms (use exactly; never invent prices, discounts or shipping terms beyond these): ${run.offer}` : run.goal) + extra;

const hostOf = (u: string) => new URL(u).hostname.replace(/^www\./, "");

export async function brandFor(run: StudioRun) {
  if (run.brandId) {
    const b = await get("brands", run.brandId);
    if (b) return b;
  }
  return (await list("brands")).find((b) => hostOf(b.url) === hostOf(run.brandUrl)) ?? null;
}

/** Brand-kit rules plus what past approvals, rejections and results taught us, for every generation prompt. */
export async function guidance(run: StudioRun) {
  const [b, l] = await Promise.all([brandFor(run), learnings(run.brandUrl)]);
  return brandRules(b) + l.text;
}

export const brandName = (url: string) => {
  const host = new URL(url).hostname.replace(/^www\./, "").split(".")[0];
  return host.charAt(0).toUpperCase() + host.slice(1);
};

export function saveStoryboardPhotos(runId: string, refs: string[]) {
  return Promise.all(refs.map((img, i) => storeMedia(img, `${runId}/ref-${i}-${createHash("sha256").update(img).digest("hex").slice(0, 16)}`)));
}

export const shortHash = (input: unknown) => createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24);

/** Swipe-file ads saved for this brand (or for any brand), used as inspirations for concepts and scripts. */
export async function swipesFor(run: StudioRun) {
  return (await list("swipes")).filter((s) => !s.brandUrl || hostOf(s.brandUrl) === hostOf(run.brandUrl)).slice(0, 8);
}
