import { chatJSON, generateImage, generateVideo, aiConfigured } from "./ai";
import { placeholderImage } from "./placeholder";
import { safeFetchText } from "./safe-fetch";
import type { Brief, Direction, QAResult, Research } from "./types";

async function fetchSiteText(url: string): Promise<{ text: string; error: string | null }> {
  try {
    const html = await safeFetchText(url);
    const text = html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 12000);
    return { text, error: null };
  } catch (e) {
    return { text: "", error: (e as Error).message };
  }
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
  const site = await fetchSiteText(brandUrl);
  if (site.error && /private|not allowed|Invalid URL/.test(site.error)) throw new Error(site.error);
  const { data, usage } = await chatJSON<Research>(
    model,
    "You are a senior performance-marketing strategist. Analyse the brand from its website copy.",
    `Goal: ${goal}\nWebsite (${brandUrl}) text:\n${site.text || `(could not fetch site: ${site.error}; infer from URL and say so in the summary)`}\n\nReturn JSON: {"summary": string (max 60 words), "audience": string, "valueProps": string[], "tone": string, "angles": string[] (5-6 distinct ad angles), "sources": string[]}`,
  );
  return { data: { ...data, sources: data.sources?.length ? data.sources : [brandUrl] }, cost: usage.costUsd };
}

export async function brief(model: string, r: Research, goal: string): Promise<{ data: Brief; cost: number }> {
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
    `Goal: ${goal}\nResearch: ${JSON.stringify(r)}\nReturn JSON: {"objective" (max 20 words),"audience" (max 15 words),"insight" (one sentence, max 25 words),"offer" (max 15 words, only facts found in research),"mandatories": string[] (3-5 items, max 10 words each),"kpi" (max 10 words)}`,
  );
  return { data, cost: usage.costUsd };
}

export async function directions(model: string, b: Brief, r: Research, format: "static" | "video"): Promise<{ data: Direction[]; cost: number }> {
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
      })),
    };
  }
  const { data, usage } = await chatJSON<{ directions: Omit<Direction, "id" | "format">[] }>(
    model,
    "You are a creative director. Pitch three genuinely different ad directions. Each must use a different angle, visual world and hook so ad platforms treat them as distinct creatives.",
    `Brief: ${JSON.stringify(b)}\nAvailable angles: ${r.angles.join(", ")}\nFormat: ${format}\nReturn JSON: {"directions":[{"title","hook","angle","script" (voiceover/copy),"visualPrompt" (detailed prompt for an image/video model, include on-image headline text)}]} with exactly 3 items.\nVisual prompt rules: on-image text is limited to the headline, at most one price/offer line and a short CTA. No fine print, legal disclaimers, placeholders like [date] or [brand], or invented facts. Show the brand name or wordmark once. Each direction must look visibly different (setting, composition, palette).`,
  );
  return { data: data.directions.slice(0, 3).map((d, i) => ({ ...d, id: `dir_${i}`, format })), cost: usage.costUsd };
}

export async function render(
  d: Direction,
  opts: { imageModel: string; videoModel: string; refs: string[]; seed: number; fixes?: string[] },
): Promise<{ url: string; type: "image" | "video"; model: string; cost: number }> {
  if (!aiConfigured()) return { url: placeholderImage(d.hook, opts.seed), type: "image", model: "demo", cost: 0 };
  if (d.format === "video") {
    const v = await generateVideo(opts.videoModel, `${d.visualPrompt}\nVoiceover: ${d.script}`);
    return { url: v.url, type: "video", model: opts.videoModel, cost: v.usage.costUsd };
  }
  const fixes = opts.fixes?.length ? `\nFix these issues from the last version: ${opts.fixes.join(" ")}` : "";
  const img = await generateImage(
    opts.imageModel,
    `${d.visualPrompt}\n4:5 vertical social ad. Crisp, legible text. Render only the text quoted above; no placeholder or fine-print text.${fixes}`,
    opts.refs,
  );
  return { url: img.url, type: "image", model: opts.imageModel, cost: img.usage.costUsd };
}

export async function qa(model: string, mediaUrl: string, mediaType: "image" | "video", b: Brief, hook: string): Promise<{ data: QAResult; cost: number }> {
  if (!aiConfigured()) {
    const score = 8 + (hook.length % 2);
    return { cost: 0, data: { score, pass: score >= QA_PASS_SCORE, notes: ["Demo score – add OPENROUTER_API_KEY for live vision QA"] } };
  }
  if (mediaType === "video") {
    return { cost: 0, data: { score: 0, pass: false, notes: ["Automated video QA isn't available yet. Watch the video and approve QA manually if it's good."] } };
  }
  const { data, usage } = await chatJSON<{ score: number; notes: string[] }>(
    model,
    "You are a strict creative director grading a paid-social ad. Score 1-10 on: hook clarity in 1s, text legibility on mobile, brand fit, visual quality/artifacts, CTA clarity, policy risk.",
    [
      { type: "text", text: `Brief: ${JSON.stringify(b)}\nIntended hook: ${hook}\nReturn JSON: {"score": number, "notes": string[] (max 4, concrete fixes)}` },
      { type: "image_url", image_url: { url: mediaUrl } },
    ],
  );
  const score = Math.max(1, Math.min(10, Math.round(data.score)));
  return { data: { score, pass: score >= QA_PASS_SCORE, notes: data.notes ?? [] }, cost: usage.costUsd };
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
