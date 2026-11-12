import { mediaDataUrl, mediaFile } from "./store";
import type { Creative, Metrics } from "./types";
import { posterFrame } from "./video-post";

const GRAPH = "https://graph.facebook.com/v21.0";

export type MetaIds = { campaignId: string; adsetId: string; creativeId: string; adId: string };

export function metaConfigured() {
  return !!(process.env.META_ACCESS_TOKEN && process.env.META_AD_ACCOUNT_ID && process.env.META_PAGE_ID);
}

const account = () => {
  const id = process.env.META_AD_ACCOUNT_ID!.trim();
  return id.startsWith("act_") ? id : `act_${id}`;
};

async function graph<T>(pathName: string, params: Record<string, unknown> | FormData, method: "GET" | "POST" = "POST"): Promise<T> {
  const token = process.env.META_ACCESS_TOKEN!;
  let res: Response;
  if (params instanceof FormData) {
    params.set("access_token", token);
    res = await fetch(`${GRAPH}/${pathName}`, { method: "POST", body: params });
  } else {
    const q = new URLSearchParams({ access_token: token });
    for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, typeof v === "string" ? v : JSON.stringify(v));
    res = method === "GET" ? await fetch(`${GRAPH}/${pathName}?${q}`) : await fetch(`${GRAPH}/${pathName}`, { method: "POST", body: q });
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; error_user_msg?: string } };
  if (!res.ok || json.error) throw new Error(`Meta ${pathName.split("/").pop()}: ${json.error?.error_user_msg || json.error?.message || res.status}`);
  return json;
}

async function uploadImage(bytes: Buffer): Promise<string> {
  const r = await graph<{ images: Record<string, { hash: string }> }>(`${account()}/adimages`, { bytes: bytes.toString("base64") });
  const hash = Object.values(r.images ?? {})[0]?.hash;
  if (!hash) throw new Error("Meta adimages: no image hash returned");
  return hash;
}

const bytesOf = async (url: string) => Buffer.from((await mediaDataUrl(url)).split(",")[1] ?? "", "base64");

/**
 * Creates a PAUSED campaign → ad set → creative → ad for one approved creative.
 * Nothing spends until someone turns it on in Ads Manager.
 */
export async function publishMetaPaused(c: Creative, o: { link: string; dailyBudget: number; countries?: string[] }): Promise<MetaIds> {
  if (!metaConfigured()) throw new Error("Meta is not connected (META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, META_PAGE_ID)");
  const name = `GTM · ${c.title}`.slice(0, 100);
  const campaign = await graph<{ id: string }>(`${account()}/campaigns`, {
    name,
    objective: "OUTCOME_TRAFFIC",
    status: "PAUSED",
    special_ad_categories: [],
    is_adset_budget_sharing_enabled: false,
  });
  const adset = await graph<{ id: string }>(`${account()}/adsets`, {
    name,
    campaign_id: campaign.id,
    daily_budget: Math.max(100, Math.round(o.dailyBudget * 100)),
    billing_event: "IMPRESSIONS",
    optimization_goal: "LINK_CLICKS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    targeting: { geo_locations: { countries: o.countries?.length ? o.countries : ["US"] } },
    status: "PAUSED",
  });
  const cta = { type: c.copy?.metaCta || "LEARN_MORE", value: { link: o.link } };
  const message = c.copy?.metaPrimaryText || c.hook;
  const title = c.copy?.metaHeadline || c.title;
  let story: Record<string, unknown>;
  if (c.mediaType === "video") {
    const file = await mediaFile(c.mediaUrl);
    if (!file) throw new Error("Video file not found for upload");
    const form = new FormData();
    const fs = await import("node:fs/promises");
    form.set("source", new Blob([new Uint8Array(await fs.readFile(file))], { type: "video/mp4" }), "ad.mp4");
    form.set("name", name);
    const video = await graph<{ id: string }>(`${account()}/advideos`, form);
    const thumb = await uploadImage(await posterFrame(file));
    story = { page_id: process.env.META_PAGE_ID, video_data: { video_id: video.id, image_hash: thumb, message, title, call_to_action: cta } };
  } else {
    const hash = await uploadImage(await bytesOf(c.mediaUrl));
    story = { page_id: process.env.META_PAGE_ID, link_data: { image_hash: hash, link: o.link, message, name: title, call_to_action: cta } };
  }
  const creative = await graph<{ id: string }>(`${account()}/adcreatives`, { name, object_story_spec: story });
  const ad = await graph<{ id: string }>(`${account()}/ads`, { name, adset_id: adset.id, creative: { creative_id: creative.id }, status: "PAUSED" });
  return { campaignId: campaign.id, adsetId: adset.id, creativeId: creative.id, adId: ad.id };
}

const CONVERSIONS = ["purchase", "offsite_conversion.fb_pixel_purchase", "lead", "offsite_conversion.fb_pixel_lead", "complete_registration"];
const REVENUE = ["purchase", "offsite_conversion.fb_pixel_purchase"];

type Insight = { spend?: string; impressions?: string; clicks?: string; actions?: { action_type: string; value: string }[]; action_values?: { action_type: string; value: string }[] };

/** Lifetime spend, impressions, clicks, conversions and revenue for one ad. */
export function insightToMetrics(row: Insight | undefined): Metrics {
  const pick = (list: Insight["actions"], types: string[]) => {
    const hit = (list ?? []).filter((a) => types.includes(a.action_type));
    // Meta reports the same purchase under several action types; take the largest, don't double count.
    return hit.length ? Math.max(...hit.map((a) => Number(a.value) || 0)) : 0;
  };
  return {
    spend: Number(row?.spend) || 0,
    impressions: Number(row?.impressions) || 0,
    clicks: Number(row?.clicks) || 0,
    conversions: pick(row?.actions, CONVERSIONS),
    revenue: pick(row?.action_values, REVENUE),
  };
}

export async function metaAdMetrics(adId: string): Promise<Metrics> {
  const r = await graph<{ data: Insight[] }>(`${adId}/insights`, { fields: "spend,impressions,clicks,actions,action_values", date_preset: "maximum" }, "GET");
  return insightToMetrics(r.data?.[0]);
}
