import { NextResponse } from "next/server";
import { metaAdMetrics, metaConfigured } from "@/lib/meta-ads";
import { list, put } from "@/lib/store";

/** Pulls lifetime spend, clicks, conversions and revenue for every published ad onto its creative (feeds the learning loop). */
export async function POST() {
  if (!metaConfigured()) return NextResponse.json({ error: "Connect Meta (META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, META_PAGE_ID) to sync results" }, { status: 400 });
  const live = (await list("creatives")).filter((c) => c.external?.meta?.adId);
  const errors: string[] = [];
  let synced = 0;
  for (const c of live) {
    try {
      c.metrics = await metaAdMetrics(c.external!.meta!.adId);
      c.metricsSyncedAt = new Date().toISOString();
      await put("creatives", c);
      synced++;
    } catch (e) {
      errors.push(`${c.title}: ${(e as Error).message}`);
    }
  }
  return NextResponse.json({ synced, total: live.length, errors });
}
