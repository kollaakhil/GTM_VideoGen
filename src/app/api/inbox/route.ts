import { NextResponse } from "next/server";
import { z } from "zod";
import { metaConfigured, publishMetaPaused } from "@/lib/meta-ads";
import { get, put } from "@/lib/store";
import { videoPublishBlock } from "@/lib/quality-policy";
import { currentUser } from "@/lib/session";

const Body = z.object({ id: z.string(), decision: z.enum(["approved", "rejected"]) });

export async function POST(req: Request) {
  if (!await currentUser().catch(() => null)) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const item = await get("inbox_items", parsed.data.id);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (item.status !== "pending") return NextResponse.json({ error: "This request has already been decided" }, { status: 409 });
  const publishing = parsed.data.decision === "approved" && item.kind === "publish";
  const creative = publishing && item.creativeId ? await get("creatives", item.creativeId) : null;
  if (publishing && !creative) return NextResponse.json({ error: "Creative not found" }, { status: 404 });
  const run = creative ? await get("studio_runs", creative.runId) : null;
  if (creative) {
    const blocking = videoPublishBlock(creative, run?.directions.find((d) => d.id === creative.directionId)?.storyboardKey);
    if (blocking) return NextResponse.json({ error: blocking }, { status: 400 });
  }
  item.status = parsed.data.decision;
  await put("inbox_items", item);

  let note = parsed.data.decision === "approved" ? "Approved" : "Rejected";
  if (publishing) {
    if (creative) {
      creative.channel = item.channel;
      creative.status = "paused";
      creative.publishError = null;
      if (item.channel === "meta" && metaConfigured()) {
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
