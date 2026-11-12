import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gateVerdict } from "@/lib/gate";
import { insightToMetrics, publishMetaPaused } from "@/lib/meta-ads";
import type { Creative } from "@/lib/types";

describe("Creative Director Gate", () => {
  it("passes only when QA, diversity, claims and must-says are all clean", () => {
    expect(gateVerdict({ qa: 8, diversity: 0.8, unsupported: [], missing: [] }).pass).toBe(true);
    const g = gateVerdict({ qa: 7, diversity: 0.4, unsupported: ["Free shipping"], missing: ["Pay after approval"] });
    expect(g.pass).toBe(false);
    expect(g.reasons).toEqual([
      "QA 7/10 is below 8",
      "Only 40% distinct from the other ads",
      "Unsupported claim: Free shipping",
      "Missing must-say: Pay after approval",
    ]);
    expect(gateVerdict({ qa: 9, diversity: null, unsupported: [], missing: [] }).pass).toBe(true);
  });
});

describe("Meta insights", () => {
  it("maps insights without double counting purchases", () => {
    const m = insightToMetrics({
      spend: "12.5",
      impressions: "4000",
      clicks: "80",
      actions: [
        { action_type: "purchase", value: "3" },
        { action_type: "offsite_conversion.fb_pixel_purchase", value: "3" },
        { action_type: "link_click", value: "80" },
      ],
      action_values: [{ action_type: "purchase", value: "150" }],
    });
    expect(m).toEqual({ spend: 12.5, impressions: 4000, clicks: 80, conversions: 3, revenue: 150 });
    expect(insightToMetrics(undefined)).toEqual({ spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 });
  });
});

describe("Meta paused publish", () => {
  const calls: { url: string; body: URLSearchParams }[] = [];
  beforeEach(() => {
    Object.assign(process.env, { META_ACCESS_TOKEN: "t", META_AD_ACCOUNT_ID: "123", META_PAGE_ID: "p1" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = new URLSearchParams(String(init?.body ?? ""));
        calls.push({ url, body });
        const json = url.endsWith("/adimages") ? { images: { a: { hash: "h1" } } } : { id: url.split("/").pop() + "_id" };
        return new Response(JSON.stringify(json), { status: 200 });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    calls.length = 0;
    for (const k of ["META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID", "META_PAGE_ID"]) delete process.env[k];
  });

  it("creates campaign, ad set, creative and ad, all PAUSED", async () => {
    const png = "data:image/png;base64," + Buffer.from("x").toString("base64");
    const c = { title: "T", hook: "H", mediaUrl: png, mediaType: "image", copy: { metaPrimaryText: "P", metaHeadline: "Head", metaCta: "SHOP_NOW" } } as unknown as Creative;
    const ids = await publishMetaPaused(c, { link: "https://brand.test", dailyBudget: 10 });
    expect(calls.map((x) => x.url.split("/").pop())).toEqual(["campaigns", "adsets", "adimages", "adcreatives", "ads"]);
    expect(calls.every((x) => x.url.includes("/act_123/"))).toBe(true);
    for (const i of [0, 1, 4]) expect(calls[i].body.get("status")).toBe("PAUSED");
    expect(calls[1].body.get("daily_budget")).toBe("1000");
    const story = JSON.parse(calls[3].body.get("object_story_spec")!);
    expect(story).toMatchObject({ page_id: "p1", link_data: { image_hash: "h1", link: "https://brand.test", call_to_action: { type: "SHOP_NOW" } } });
    expect(ids.adId).toBe("ads_id");
  });

  it("surfaces Meta errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid page" } }), { status: 400 })));
    await expect(publishMetaPaused({ title: "T" } as Creative, { link: "x", dailyBudget: 5 })).rejects.toThrow("Invalid page");
  });
});
