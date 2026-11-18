import { NextResponse } from "next/server";
import { openrouterCredits, videoPricePerSec } from "@/lib/ai";
import { MODELS, providerConfigured } from "@/lib/models";
import { currentUser } from "@/lib/session";
import { realSetStatus } from "@/lib/real-set";
import { upscalerAvailable } from "@/lib/upscale";

export async function GET() {
  try {
    await currentUser();
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const video = MODELS.filter((m) => m.modality === "video" && (m.provider === "openrouter" || providerConfigured(m.provider)));
  const [credits, upscaler, rows] = await Promise.all([
    openrouterCredits(),
    upscalerAvailable(),
    Promise.all(video.map(async (m) => [m.id, m.provider === "hfmcp" ? { draft: null, final: null } : { draft: await videoPricePerSec(m.id, "480p", false), final: await videoPricePerSec(m.id, "1080p", false) }] as const)),
  ]);
  return NextResponse.json({ credits, prices: Object.fromEntries(rows), realSet: realSetStatus(), upscaler });
}
