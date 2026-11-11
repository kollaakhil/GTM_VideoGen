import { NextResponse } from "next/server";
import { z } from "zod";
import { get, list, newId, put } from "@/lib/store";

export async function GET() {
  return NextResponse.json({ creatives: await list("creatives") });
}

const Patch = z.object({
  id: z.string(),
  action: z.enum(["approve", "reject", "request_publish"]),
  channel: z.enum(["meta", "google"]).optional(),
});

export async function PATCH(req: Request) {
  const parsed = Patch.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { id, action, channel } = parsed.data;
  const creative = await get("creatives", id);
  if (!creative) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (action === "approve") creative.status = "approved";
  if (action === "reject") creative.status = "rejected";
  if (action === "request_publish") {
    if (!creative.qa?.pass) return NextResponse.json({ error: "Creative must pass the QA gate (8/10) first" }, { status: 400 });
    const ch = channel ?? "meta";
    await put("inbox_items", {
      id: newId("ibx"),
      kind: "publish",
      title: `Publish “${creative.title}” to ${ch === "meta" ? "Meta" : "Google Ads"}`,
      detail: "Will be created as a PAUSED ad. Nothing spends until you activate it.",
      channel: ch,
      creativeId: creative.id,
      dailyBudget: null,
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    creative.status = "approved";
  }
  await put("creatives", creative);
  return NextResponse.json({ creative });
}
