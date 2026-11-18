import { NextResponse } from "next/server";
import { z } from "zod";
import { get, list, newId, put } from "@/lib/store";
import { currentUser } from "@/lib/session";
import { videoPublishBlock } from "@/lib/quality-policy";

export async function GET() {
  return NextResponse.json({ creatives: await list("creatives") });
}

const Patch = z.object({
  id: z.string(),
  action: z.enum(["approve", "reject", "request_publish", "override_qa"]),
  channel: z.enum(["meta", "google"]).optional(),
  reason: z.string().trim().max(300).optional(),
});

export async function PATCH(req: Request) {
  const user = await currentUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { id, action, channel, reason } = parsed.data;
  const creative = await get("creatives", id);
  if (!creative) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (action === "override_qa") {
    if (creative.mediaType === "video") return NextResponse.json({ error: "Video QA cannot be overridden. Repair and verify the export first." }, { status: 400 });
    if (!creative.qa) return NextResponse.json({ error: "Creative has no QA result" }, { status: 400 });
    creative.qa = { ...creative.qa, pass: true, notes: [`QA manually approved by ${user}`, ...creative.qa.notes] };
    creative.qaOverride = { by: user, at: new Date().toISOString() };
  }
  if (action === "approve" || action === "reject") {
    if (action === "approve" && creative.mediaType === "video") {
      const run = await get("studio_runs", creative.runId);
      const blocking = videoPublishBlock({ ...creative, status: "approved" }, run?.directions.find((d) => d.id === creative.directionId)?.storyboardKey);
      if (blocking) return NextResponse.json({ error: blocking }, { status: 400 });
    }
    creative.status = action === "approve" ? "approved" : "rejected";
    creative.feedback = { decision: action, ...(reason ? { reason } : {}), by: user, at: new Date().toISOString() };
  }
  if (action === "request_publish") {
    if (creative.mediaType === "video") {
      const run = await get("studio_runs", creative.runId);
      const blocking = videoPublishBlock(creative, run?.directions.find((d) => d.id === creative.directionId)?.storyboardKey);
      if (blocking) return NextResponse.json({ error: blocking }, { status: 400 });
    }
    if (!creative.qa?.pass) return NextResponse.json({ error: "Creative must pass the QA gate first" }, { status: 400 });
    const blocking = (creative.gate?.reasons ?? []).filter((r) => !(creative.qaOverride && r.startsWith("QA ")));
    if (blocking.length) return NextResponse.json({ error: `Creative Director Gate: ${blocking.join("; ")}` }, { status: 400 });
    const ch = channel ?? "meta";
    await put("inbox_items", {
      id: newId("ibx"),
      kind: "publish",
      title: `Publish “${creative.title}” to ${ch === "meta" ? "Meta" : "Google Ads"}`,
      detail: `Requested by ${user}. Will be created as a PAUSED ad; nothing spends until you activate it.`,
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
