import { NextResponse } from "next/server";
import { z } from "zod";
import { metaConfigured, publishMetaPaused } from "@/lib/meta-ads";
import { get, put } from "@/lib/store";

const Body = z.object({ id: z.string(), decision: z.enum(["approved", "rejected"]) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const item = await get("inbox_items", parsed.data.id);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  item.status = parsed.data.decision;
  await put("inbox_items", item);

  let note = parsed.data.decision === "approved" ? "Approved" : "Rejected";
  if (parsed.data.decision === "approved" && item.kind === "publish" && item.creativeId) {
    const creative = await get("creatives", item.creativeId);
    if (creative) {
      creative.channel = item.channel;
      creative.status = "paused";
      creative.publishError = null;
      if (item.channel === "meta" && metaConfigured()) {
        const run = await get("studio_runs", creative.runId);
        try {
          const ids = await publishMetaPaused(creative, { link: run?.brandUrl ?? "", dailyBudget: item.dailyBudget ?? 10 });
          creative.external = { ...(creative.external ?? {}), meta: ids };
          note = "Approved – created as a PAUSED ad in Meta Ads Manager";
        } catch (e) {
          creative.publishError = (e as Error).message;
          note = `Approved, but Meta rejected the ad: ${creative.publishError}`;
        }
      } else {
        const connected = item.channel === "meta" ? metaConfigured() : !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
        note = connected ? "Approved – queued as PAUSED ad" : "Approved – will publish once the ad account is connected";
      }
      await put("creatives", creative);
    }
  }
  return NextResponse.json({ item, note });
}
