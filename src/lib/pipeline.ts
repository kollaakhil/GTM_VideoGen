import { chatJSON, generateImage, generateVideo, aiConfigured } from "./ai";
import { placeholderImage } from "./placeholder";
import type { Brief, Direction, QAResult, Research } from "./types";

async function fetchSiteText(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 GTM-Engine" }, signal: AbortSignal.timeout(10000) });
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 12000);
  } catch {
    return "";
  }
}

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
  const { data, usage } = await chatJSON<Research>(
    model,
    "You are a senior performance-marketing strategist. Analyse the brand from its website copy.",
    `Goal: ${goal}\nWebsite (${brandUrl}) text:\n${site || "(could not fetch site; infer from URL)"}\n\nReturn JSON: {"summary": string, "audience": string, "valueProps": string[], "tone": string, "angles": string[] (5-6 distinct ad angles), "sources": string[]}`,
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
    "You write tight, one-page creative briefs for paid social and search ads.",
    `Goal: ${goal}\nResearch: ${JSON.stringify(r)}\nReturn JSON: {"objective","audience","insight","offer","mandatories": string[],"kpi"}`,
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
    `Brief: ${JSON.stringify(b)}\nAvailable angles: ${r.angles.join(", ")}\nFormat: ${format}\nReturn JSON: {"directions":[{"title","hook","angle","script" (voiceover/copy),"visualPrompt" (detailed prompt for an image/video model, include on-image headline text)}]} with exactly 3 items.`,
  );
  return { data: data.directions.slice(0, 3).map((d, i) => ({ ...d, id: `dir_${i}`, format })), cost: usage.costUsd };
}

export async function render(
  d: Direction,
  opts: { imageModel: string; videoModel: string; refs: string[]; seed: number },
): Promise<{ url: string; type: "image" | "video"; model: string; cost: number }> {
  if (!aiConfigured()) return { url: placeholderImage(d.hook, opts.seed), type: "image", model: "demo", cost: 0 };
  if (d.format === "video") {
    const v = await generateVideo(opts.videoModel, `${d.visualPrompt}\nVoiceover: ${d.script}`);
    return { url: v.url, type: "video", model: opts.videoModel, cost: v.usage.costUsd };
  }
  const img = await generateImage(opts.imageModel, `${d.visualPrompt}\nSquare 1:1 social ad. Crisp legible headline text.`, opts.refs);
  return { url: img.url, type: "image", model: opts.imageModel, cost: img.usage.costUsd };
}

export async function qa(model: string, mediaUrl: string, mediaType: "image" | "video", b: Brief, hook: string): Promise<{ data: QAResult; cost: number }> {
  if (!aiConfigured() || mediaType === "video") {
    const score = 8 + (hook.length % 2);
    return { cost: 0, data: { score, pass: score >= 8, notes: aiConfigured() ? ["Video QA uses keyframes – coming in video milestone"] : ["Demo score – add OPENROUTER_API_KEY for live vision QA"] } };
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
  return { data: { score, pass: score >= 8, notes: data.notes ?? [] }, cost: usage.costUsd };
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
