import { NextResponse } from "next/server";
import { z } from "zod";
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
    const connected = item.channel === "meta" ? !!process.env.META_ACCESS_TOKEN : !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    if (creative) {
      creative.channel = item.channel;
      creative.status = "paused";
      await put("creatives", creative);
    }
    note = connected ? "Approved – queued as PAUSED ad" : "Approved – will publish once the ad account is connected";
  }
  return NextResponse.json({ item, note });
}
