import { chatJSON, aiConfigured } from "./ai";
import { safeFetchText } from "./safe-fetch";
import type { Research, VoiceOfCustomer } from "./types";

/** Classic direct-response principles (Ogilvy, Schwartz, Hopkins, Sugarman, modern paid social) every brief and concept must follow. */
export const AD_PRINCIPLES = [
  "Lead with the customer's problem or desire in their own words, not the brand's features (Schwartz: channel existing desire).",
  "Match the message to awareness level: unaware -> story/problem, problem-aware -> agitate + solution, solution-aware -> why us, product-aware -> offer + proof, most-aware -> deal + urgency.",
  "One ad, one idea, one promise. Specific beats general: numbers, places, prices and named outcomes (Hopkins, Ogilvy).",
  "The first 1 second decides everything: show the product, the problem or a pattern interrupt immediately; never open on a logo or empty scene.",
  "Proof before promise: demonstrations, real results, reviews, before/after; make the claim believable (Ogilvy: the consumer isn't a moron).",
  "Every line must earn the next one (Sugarman's slippery slide); cut anything that doesn't sell.",
  "Show the product in use by the target customer, in their world, at native phone framing.",
  "Remove the risk: guarantees, returns, pay-after-approval, free trials; state the offer and CTA plainly at the end.",
  "Native beats polished on social: ads should feel like content from a person, not a commercial, unless the brand is premium.",
  "Distinct concepts, not variations: change the persona, angle, format and setting so platforms treat each ad as a separate creative (Meta Andromeda Entity IDs).",
];

/** Proven static-ad formats for the concept matrix. */
export const STATIC_FORMATS = ["Product hero", "Problem / solution", "Customer quote", "Before / after", "Us vs them", "Offer callout", "3 reasons why", "UGC-style photo"];

export const principlesBlock = () => `\nAd principles (must follow):\n- ${AD_PRINCIPLES.join("\n- ")}`;

const strip = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

async function redditText(query: string): Promise<{ text: string; source: string | null }> {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=25&sort=relevance&t=year`;
  try {
    const raw = JSON.parse(await safeFetchText(url)) as { data?: { children?: { data: { title: string; selftext?: string; subreddit: string } }[] } };
    const posts = raw.data?.children?.map((c) => `[r/${c.data.subreddit}] ${c.data.title}. ${(c.data.selftext ?? "").slice(0, 300)}`) ?? [];
    return posts.length ? { text: posts.join("\n").slice(0, 7000), source: url } : { text: "", source: null };
  } catch {
    return { text: "", source: null };
  }
}

async function reviewText(brandUrl: string): Promise<{ text: string; source: string | null }> {
  for (const p of ["/reviews", "/pages/reviews", "/testimonials"]) {
    try {
      const u = new URL(p, brandUrl).toString();
      const t = strip(await safeFetchText(u));
      if (t.length > 400) return { text: t.slice(0, 5000), source: u };
    } catch {}
  }
  return { text: "", source: null };
}

/** Customer language mined from Reddit and the brand's review pages: the words hooks should use. */
export async function voiceOfCustomer(model: string, brandUrl: string, r: Research): Promise<{ data: VoiceOfCustomer; cost: number }> {
  if (!aiConfigured()) {
    return { cost: 0, data: { phrases: ["I wish this was easier"], pains: ["Takes too long"], desires: ["Look great without effort"], objections: ["Too expensive"], sources: [] } };
  }
  const brand = r.brand || new URL(brandUrl).hostname.replace(/^www\./, "");
  const category = r.angles?.[0] ? `${r.audience}` : brand;
  const [byBrand, byCategory, reviews] = await Promise.all([redditText(brand), redditText(category.split(/[,.;]/)[0].slice(0, 60)), reviewText(brandUrl)]);
  const corpus = [byBrand.text, byCategory.text, reviews.text].filter(Boolean).join("\n\n");
  const { data, usage } = await chatJSON<Omit<VoiceOfCustomer, "sources">>(
    model,
    "You are a direct-response researcher. Extract real customer language. Quote or closely paraphrase actual phrasing; never invent testimonials or statistics.",
    `Brand: ${brand}\nWhat the brand sells: ${r.summary}\nAudience: ${r.audience}\n${corpus ? `Customer discussions and reviews:\n${corpus}` : "(No public discussions found; infer likely customer language from the audience and say nothing that sounds like a quote.)"}\n\nReturn JSON: {"phrases": string[] (6-10 short phrases customers actually use about this problem/category), "pains": string[] (4-6), "desires": string[] (4-6), "objections": string[] (3-5 reasons people hesitate to buy), "quotes": string[] (4-8 full sentences copied word for word from the discussions above, the most vivid ones about the problem or the product; [] when there are no discussions)}`,
  );
  return { data: { ...data, sources: [byBrand.source, byCategory.source, reviews.source].filter((s): s is string => !!s) }, cost: usage.costUsd };
}

export const vocBlock = (v?: VoiceOfCustomer | null) =>
  v ? `\nVoice of customer (use their words in hooks; answer objections):\n- Phrases: ${v.phrases.join(" | ")}${v.quotes?.length ? `\n- Real customer quotes (borrow their wording, never attribute them): ${v.quotes.slice(0, 8).map((q) => `"${q}"`).join(" ")}` : ""}\n- Pains: ${v.pains.join("; ")}\n- Desires: ${v.desires.join("; ")}\n- Objections: ${v.objections.join("; ")}` : "";
