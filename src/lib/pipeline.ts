import { chatJSON, generateImage, generateVideo, aiConfigured } from "./ai";
import { placeholderImage } from "./placeholder";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { safeFetchText } from "./safe-fetch";
import { captionVariants, spokenScript } from "./video-post";
import type { OrganicPack, StyleDNA, Brief, Direction, QAResult, Research } from "./types";

type Site = { text: string; error: string | null; styleRef: string | null; colors: string[] };

/** Brand style cues from raw HTML: og:image as the visual reference and the most frequent hex colors. */
export function brandStyle(html: string, base: string): { styleRef: string | null; colors: string[] } {
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  let styleRef: string | null = null;
  if (og) {
    try {
      const u = new URL(og[1].replace(/&amp;/g, "&"), base);
      if (u.protocol === "https:") styleRef = u.toString();
    } catch {}
  }
  const counts = new Map<string, number>();
  for (const m of html.matchAll(/#([0-9a-f]{6})\b/gi)) {
    const hex = `#${m[1].toLowerCase()}`;
    if (hex === "#ffffff" || hex === "#000000") continue;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  const colors = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => c);
  return { styleRef, colors };
}

async function fetchSite(url: string): Promise<Site> {
  try {
    const html = await safeFetchText(url);
    const text = html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 12000);
    return { text, error: null, ...brandStyle(html, url) };
  } catch (e) {
    return { text: "", error: (e as Error).message, styleRef: null, colors: [] };
  }
}

/** Distils a reference brand's creative style so it can be applied to a different brand without copying it. */
export async function styleDNA(model: string, referenceUrl: string): Promise<{ data: StyleDNA; cost: number }> {
  if (!aiConfigured()) {
    return {
      cost: 0,
      data: {
        referenceUrl, brand: new URL(referenceUrl).hostname, tone: "Irreverent, deadpan, punk-rock confidence", humor: "Absurdist and self-aware",
        visualLanguage: "High-contrast black and white with one loud accent color, heavy condensed type", pacing: "Fast cuts, abrupt hard stops",
        hookPatterns: ["Shock opener", "Mock-serious announcement"], copyRules: ["Short declarative lines", "Never earnest"], doNotCopy: ["Logo", "Slogans", "Mascots"],
        styleRef: null, colors: [],
      },
    };
  }
  const site = await fetchSite(referenceUrl);
  if (site.error && /private|not allowed|Invalid URL/.test(site.error)) throw new Error(site.error);
  const { data, usage } = await chatJSON<Omit<StyleDNA, "referenceUrl" | "styleRef" | "colors">>(
    model,
    "You are a brand strategist who reverse-engineers a reference brand's creative style so another brand can borrow the *approach*, never the assets.",
    `Reference brand site (${referenceUrl}):\n${site.text || `(could not fetch: ${site.error}; use what you know about this brand and say so)`}\n\nReturn JSON: {"brand": string, "tone": string (max 15 words), "humor": string (max 12 words), "visualLanguage": string (max 25 words: palette, type, photography, composition), "pacing": string (max 15 words, for video), "hookPatterns": string[] (3-5 recurring hook formulas, abstracted), "copyRules": string[] (3-5 rules), "doNotCopy": string[] (their trademarks, slogans, mascots, product names, signature phrases)}`,
  );
  return { data: { ...data, referenceUrl, styleRef: site.styleRef, colors: site.colors }, cost: usage.costUsd };
}

const styleBlock = (d?: StyleDNA | null) =>
  d
    ? `\nCreative style to borrow (from ${d.brand}, applied to OUR brand): tone: ${d.tone}; humor: ${d.humor}; visuals: ${d.visualLanguage}; pacing: ${d.pacing}; hook patterns: ${d.hookPatterns.join("; ")}; copy rules: ${d.copyRules.join("; ")}. Never use or reference: ${d.doNotCopy.join(", ")}, or ${d.brand}'s name, logo or claims.`
    : "";

/** Organic (unpaid) content pack for the same brief: one post per channel plus a carousel. */
export async function organic(model: string, b: Brief, r: Research, style?: StyleDNA | null): Promise<{ data: OrganicPack; cost: number }> {
  if (!aiConfigured()) {
    return {
      cost: 0,
      data: {
        instagram: { caption: `${b.insight} ${b.offer}`, hashtags: ["#launch", "#newdrop"] },
        tiktok: { hook: "POV: you finally found it", script: `${b.insight} ${b.offer}`, onScreenText: ["You finally found it", b.offer] },
        linkedin: `${b.objective}\n\n${b.insight}`,
        xThread: [b.insight, b.offer],
        carousel: [{ title: "The problem", body: b.insight }, { title: "The fix", body: b.offer }],
      },
    };
  }
  const { data, usage } = await chatJSON<OrganicPack>(
    model,
    "You are a social media lead writing organic (unpaid) posts. Native to each platform, no ad-speak, only facts from the brief.",
    `Brief: ${JSON.stringify(b)}\nBrand tone: ${r.tone}${styleBlock(style)}\nReturn JSON: {"instagram":{"caption" (max 300 chars),"hashtags" (5-8)},"tiktok":{"hook" (first 2 seconds, max 10 words),"script" (15-25s spoken),"onScreenText" (3-5 short lines)},"linkedin" (max 900 chars),"xThread" (3-5 posts, max 270 chars each),"carousel" (5-7 slides of {"title" max 6 words,"body" max 25 words})}`,
  );
  return { data, cost: usage.costUsd };
}

export const QA_PASS_SCORE = Number(process.env.QA_PASS_SCORE) || 8;

export async function research(model: string, brandUrl: string, goal: string): Promise<{ data: Research; cost: number }> {
  if (!aiConfigured()) {
    return {
      cost: 0,
      data: {
        summary: `Demo research for ${brandUrl}. Add OPENROUTER_API_KEY for live research.`,
        audience: "Growth-stage founders and marketing leads running paid social",
        valueProps: ["Ships creative 10x faster", "Closes the loop between spend and revenue", "Brand-safe by default"],
        tone: "Confident, direct, a little irreverent",
        angles: ["Time saved", "Pain of wasted spend", "Social proof", "Founder story"],
        sources: [brandUrl],
      },
    };
  }
  const site = await fetchSite(brandUrl);
  if (site.error && /private|not allowed|Invalid URL/.test(site.error)) throw new Error(site.error);
  const { data, usage } = await chatJSON<Research>(
    model,
    "You are a senior performance-marketing strategist. Analyse the brand from its website copy.",
    `Goal: ${goal}\nWebsite (${brandUrl}) text:\n${site.text || `(could not fetch site: ${site.error}; infer from URL and say so in the summary)`}\n\nReturn JSON: {"summary": string (max 60 words), "audience": string, "valueProps": string[], "tone": string, "angles": string[] (5-6 distinct ad angles), "sources": string[]}`,
  );
  return {
    data: { ...data, sources: data.sources?.length ? data.sources : [brandUrl], styleRef: site.styleRef, colors: site.colors },
    cost: usage.costUsd,
  };
}

export async function brief(model: string, r: Research, goal: string, style?: StyleDNA | null): Promise<{ data: Brief; cost: number }> {
  if (!aiConfigured()) {
    return {
      cost: 0,
      data: {
        objective: goal,
        audience: r.audience,
        insight: "Teams don't lack ideas, they lack a fast loop from idea to proof.",
        offer: "14-day free trial",
        mandatories: ["Logo in first 2s", "Brand colors", "Clear CTA"],
        kpi: "CPA under $40",
      },
    };
  }
  const { data, usage } = await chatJSON<Brief>(
    model,
    "You write tight creative briefs for paid social and search ads. Be specific and brief; a busy founder must read it in 20 seconds.",
    `Goal: ${goal}\nResearch: ${JSON.stringify(r)}${styleBlock(style)}\nReturn JSON: {"objective" (max 20 words),"audience" (max 15 words),"insight" (one sentence, max 25 words),"offer" (max 15 words, only facts found in research),"mandatories": string[] (3-5 items, max 10 words each),"kpi" (max 10 words)}`,
  );
  return { data, cost: usage.costUsd };
}

export async function directions(model: string, b: Brief, r: Research, format: "static" | "video", style?: StyleDNA | null): Promise<{ data: Direction[]; cost: number }> {
  if (!aiConfigured()) {
    const demo = [
      { title: "Before / after", hook: "From 3 hours to 3 minutes", angle: "Time saved" },
      { title: "Wasted spend", hook: "Half your ad budget is guessing", angle: "Pain point" },
      { title: "Founder story", hook: "We built this after burning $40k on ads", angle: "Origin story" },
    ];
    return {
      cost: 0,
      data: demo.map((d, i) => ({
        id: `dir_${i}`,
        ...d,
        format,
        script: `VO: ${d.hook}. ${b.insight} Start your ${b.offer} today.`,
        visualPrompt: `Bold ${format} ad, ${d.angle.toLowerCase()} concept, headline "${d.hook}"`,
        copy: {
          metaPrimaryText: `${d.hook}. ${b.insight} Start your ${b.offer} today.`.slice(0, 125),
          metaHeadline: d.hook.slice(0, 40),
          metaCta: "SIGN_UP",
          googleHeadlines: [d.hook.slice(0, 30), d.angle.slice(0, 30), b.offer.slice(0, 30)],
          googleDescriptions: [b.insight.slice(0, 90)],
        },
      })),
    };
  }
  const { data, usage } = await chatJSON<{ directions: Omit<Direction, "id" | "format">[] }>(
    model,
    "You are a creative director. Pitch three genuinely different ad directions. Each must use a different angle, visual world and hook so ad platforms treat them as distinct creatives.",
    `Brief: ${JSON.stringify(b)}\nAvailable angles: ${r.angles.join(", ")}\nFormat: ${format}${styleBlock(style)}\nReturn JSON: {"directions":[{"title","hook","angle","script" (only the words spoken aloud, no speaker labels, stage directions, brackets or notes),"visualPrompt" (${format === "video" ? "shot-by-shot scene description for a video model: subject, setting, camera moves, lighting. No text, signs, labels, price tags, logos or packaging copy anywhere in frame; captions are added in post" : "detailed prompt for an image model, include on-image headline text"}),"copy":{"metaPrimaryText" (max 125 chars),"metaHeadline" (max 40 chars),"metaCta" (one of SHOP_NOW, LEARN_MORE, SIGN_UP, GET_OFFER, ORDER_NOW),"googleHeadlines" (5 items, max 30 chars each),"googleDescriptions" (2 items, max 90 chars each)}}]} with exactly 3 items. Ad copy must use only facts from the brief.\n${format === "video" ? "" : "Visual prompt rules: on-image text is limited to the headline, at most one price/offer line and a short CTA. No fine print, legal disclaimers, placeholders like [date] or [brand], or invented facts. Show the brand name or wordmark once."} Each direction must look visibly different (setting, composition, palette).`,
  );
  return { data: data.directions.slice(0, 3).map((d, i) => ({ ...d, id: `dir_${i}`, format })), cost: usage.costUsd };
}

export async function render(
  d: Direction,
  opts: { imageModel: string; videoModel: string; refs: string[]; seed: number; fixes?: string[]; style?: { styleRef?: string | null; colors?: string[] } },
): Promise<{ url: string; type: "image" | "video"; model: string; cost: number; variants?: { aspect: string; url: string }[] }> {
  if (!aiConfigured()) return { url: placeholderImage(d.hook, opts.seed), type: "image", model: "demo", cost: 0 };
  if (d.format === "video") {
    const v = await generateVideo(
      opts.videoModel,
      `${d.visualPrompt}\nDo not render any on-screen text, captions, prices, labels or logos; captions are added in post. Product must look exactly like the reference photo if one is given.\nSpoken voiceover: "${spokenScript(d.script)}"`,
      opts.refs[0],
    );
    const variants = await captionVariants(v.url, d.script).catch((e) => {
      console.error("caption/variants failed", (e as Error).message);
      return [];
    });
    const main = variants.find((x) => x.aspect === "9:16")?.url ?? v.url;
    return { url: main, type: "video", model: opts.videoModel, cost: v.usage.costUsd, variants };
  }
  const fixes = opts.fixes?.length ? `\nFix these issues from the last version: ${opts.fixes.join(" ")}` : "";
  const colors = opts.style?.colors?.length ? `\nBrand colors: ${opts.style.colors.join(", ")}.` : "";
  const useStyleRef = !opts.refs.length && !!opts.style?.styleRef;
  const styleNote = useStyleRef
    ? "\nThe attached image is the brand's own site image: match its wordmark, palette and look only. Do not copy its headline, people or logos of other companies."
    : "";
  const img = await generateImage(
    opts.imageModel,
    `${d.visualPrompt}\n4:5 vertical social ad. Crisp, legible text. Render all text exactly as written and only the text quoted above; no placeholder or fine-print text, no made-up handles or URLs. No drop shadows, robots or glowing AI imagery.${colors}${styleNote}${fixes}`,
    useStyleRef ? [opts.style!.styleRef!] : opts.refs,
  );
  return { url: img.url, type: "image", model: opts.imageModel, cost: img.usage.costUsd };
}

export async function qa(model: string, mediaUrl: string, mediaType: "image" | "video", b: Brief, hook: string): Promise<{ data: QAResult; cost: number }> {
  if (!aiConfigured()) {
    const score = 8 + (hook.length % 2);
    return { cost: 0, data: { score, pass: score >= QA_PASS_SCORE, notes: ["Demo score – add OPENROUTER_API_KEY for live vision QA"] } };
  }
  if (mediaType === "video") return videoQA(model, mediaUrl, b, hook);
  const { data, usage } = await chatJSON<{ score: number; notes: string[] }>(
    model,
    `${QA_RUBRIC} Also fail any misspelled word, made-up social handle or URL, wordmark that doesn't match the brand, or copied third-party logo.`,
    [
      { type: "text", text: `Brief: ${JSON.stringify(b)}\nIntended hook: ${hook}\nReturn JSON: {"score": number, "notes": string[] (max 4, concrete fixes)}` },
      { type: "image_url", image_url: { url: mediaUrl } },
    ],
  );
  const score = Math.max(1, Math.min(10, Math.round(data.score)));
  return { data: { score, pass: score >= QA_PASS_SCORE, notes: data.notes ?? [] }, cost: usage.costUsd };
}

const QA_RUBRIC =
  "You are a strict creative director grading a paid-social ad. Score 1-10 on: hook clarity in the first second, text legibility at phone size, brand fit, visual quality and AI artifacts, CTA clarity, and policy risk.";

const run = promisify(execFile);
const FFMPEG = ffmpegPath || "ffmpeg";
const FRAME_TIMES = [0, 0.5, 1.5, 3, 4.5, 6, 8, 10];

/** Samples a filmstrip of keyframes (first frame, hook window, body, end) into one contact sheet. */
export async function filmstrip(video: string): Promise<{ sheet: string; frames: number[] }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gtm-qa-"));
  try {
    let input = video;
    if (video.startsWith("data:")) {
      input = path.join(dir, "in.mp4");
      await fs.writeFile(input, Buffer.from(video.split(",")[1], "base64"));
    }
    const probe = await run(FFMPEG, ["-hide_banner", "-i", input], { timeout: 30_000 }).catch((e) => e as { stderr?: string });
    const m = String(probe.stderr ?? "").match(/Duration: (\d+):(\d+):([\d.]+)/);
    const duration = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 6;
    const frames = [...FRAME_TIMES.filter((t) => t < duration - 0.2), Math.max(0, duration - 0.15)].slice(0, 8);
    const tiles: string[] = [];
    for (const [i, t] of frames.entries()) {
      const out = path.join(dir, `f${i}.jpg`);
      await run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-ss", String(t), "-i", input, "-frames:v", "1", "-vf", "scale=360:-2", "-y", out], { timeout: 30_000 });
      tiles.push(out);
    }
    const sheetPath = path.join(dir, "sheet.jpg");
    const cols = Math.min(4, tiles.length);
    const rows = Math.ceil(tiles.length / cols);
    await run(
      FFMPEG,
      ["-hide_banner", "-loglevel", "error", "-start_number", "0", "-i", path.join(dir, "f%d.jpg"), "-vf", `tile=${cols}x${rows}:padding=6:color=black`, "-frames:v", "1", "-q:v", "4", "-y", sheetPath],
      { timeout: 60_000 },
    );
    const sheet = `data:image/jpeg;base64,${(await fs.readFile(sheetPath)).toString("base64")}`;
    return { sheet, frames };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function videoQA(model: string, video: string, b: Brief, hook: string): Promise<{ data: QAResult; cost: number }> {
  let strip: { sheet: string; frames: number[] };
  try {
    strip = await filmstrip(video);
  } catch (e) {
    return { cost: 0, data: { score: 0, pass: false, notes: [`Couldn't sample frames for QA (${(e as Error).message.slice(0, 120)}). Review the video and approve QA manually.`] } };
  }
  const { data, usage } = await chatJSON<{ score: number; notes: string[] }>(
    model,
    `${QA_RUBRIC} You are reviewing a filmstrip of a vertical video ad: frames left-to-right, top-to-bottom at ${strip.frames.map((t) => `${t.toFixed(1)}s`).join(", ")}. Judge it frame by frame: the first frame must show a meaningful focal point (not black, a fade or a logo wait); the hook and product must be clear within ~2 seconds with sound off; on-screen text must be readable and spelled correctly; check for AI artifacts (morphing hands, faces, warped product or text), continuity breaks, and whether the ending gives the CTA or product enough hold. You only see frames, not audio: never comment on voiceover or sound.`,
    [
      { type: "text", text: `Brief: ${JSON.stringify(b)}\nIntended hook: ${hook}\nReturn JSON: {"score": number, "notes": string[] (max 4, concrete fixes, cite the frame time)}` },
      { type: "image_url", image_url: { url: strip.sheet } },
    ],
  );
  const score = Math.max(1, Math.min(10, Math.round(data.score)));
  return { data: { score, pass: score >= QA_PASS_SCORE, notes: [`Filmstrip QA on ${strip.frames.length} frames`, ...(data.notes ?? [])] }, cost: usage.costUsd };
}

function tokens(s: string) {
  return new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);
}

export function diversityScores(prompts: string[]): number[] {
  const sets = prompts.map(tokens);
  return sets.map((a, i) => {
    let maxSim = 0;
    sets.forEach((b, j) => {
      if (i === j) return;
      const inter = [...a].filter((t) => b.has(t)).length;
      const union = new Set([...a, ...b]).size || 1;
      maxSim = Math.max(maxSim, inter / union);
    });
    return Math.round((1 - maxSim) * 100) / 100;
  });
}
