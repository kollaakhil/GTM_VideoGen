import type { StudioRun } from "@/lib/types";
import { WRITERS, JUDGES } from "./constants";

/** Accepts "allbirds.com", "www.x.com", or a URL pasted after the prefilled "https://" ("https://https://x.com"). */
export const fullUrl = (u: string) => {
  const t = u.trim().replace(/^(https?:\/\/)+(?=https?:\/\/)/i, "");
  return !t || /^https?:\/\/$/i.test(t) ? "" : /^https?:\/\//i.test(t) ? t : `https://${t}`;
};

export const urlOk = (u: string) => /^https?:\/\/[^/\s]+\.[^/\s]+/.test(fullUrl(u));

export const hostName = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

export const money = (n: number | null | undefined) => (n == null ? "?" : `$${n.toFixed(2)}`);

export const scoreTone = (n: number) => (n >= 9 ? "bg-emerald-500/15 text-emerald-300" : n >= 6 ? "bg-amber-500/15 text-amber-300" : "bg-red-500/15 text-red-300");

const saved = (key: string, list: Record<string, string>) => {
  const v = typeof window === "undefined" ? null : localStorage.getItem(key);
  return v && v in list ? v : Object.keys(list)[0];
};

export const savedWriter = () => saved("gtm.writer", WRITERS);

export const savedJudge = () => saved("gtm.judge", JUDGES);

/** Mirrors judgeFor on the server: nobody grades their own scripts. */
export const judgeOf = (w: string, j: string) => (j !== w ? j : Object.keys(JUDGES).find((m) => m !== w)!);

export const noop = () => {};

export function storyboardPhotos(run: StudioRun, form: { refs: string[]; brandUrl: string; kits: { id: string; url: string; photos?: string[] }[] }) {
  if (run.storyboardPhotos?.length) return { count: run.storyboardPhotos.length };
  const refs = hostName(fullUrl(form.brandUrl)) === hostName(run.brandUrl) ? form.refs : [];
  if (refs.length) return { count: refs.length, refs };
  const kit = form.kits.find((b) => b.id === run.brandId) ?? form.kits.find((b) => hostName(b.url) === hostName(run.brandUrl));
  return { count: kit?.photos?.length ?? 0 };
}
