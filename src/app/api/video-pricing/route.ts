import { NextResponse } from "next/server";
import { openrouterCredits, videoPricePerSec } from "@/lib/ai";
import { MODELS } from "@/lib/models";
import { currentUser } from "@/lib/session";

export async function GET() {
  try {
    await currentUser();
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const video = MODELS.filter((m) => m.modality === "video" && m.provider === "openrouter");
  const [credits, rows] = await Promise.all([
    openrouterCredits(),
    Promise.all(video.map(async (m) => [m.id, { draft: await videoPricePerSec(m.id, "720p", false), final: await videoPricePerSec(m.id, "1080p", false) }] as const)),
  ]);
  return NextResponse.json({ credits, prices: Object.fromEntries(rows) });
}
