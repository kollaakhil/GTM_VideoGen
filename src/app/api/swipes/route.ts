import { NextResponse } from "next/server";
import { z } from "zod";
import { aiConfigured, chatJSON, type Part } from "@/lib/ai";
import { DEFAULTS } from "@/lib/models";
import { safeFetchText } from "@/lib/safe-fetch";
import { get, list, newId, put, remove, storeMedia } from "@/lib/store";
import { currentUser } from "@/lib/session";
import type { Swipe } from "@/lib/types";

export const maxDuration = 60;

export async function GET() {
  return NextResponse.json({ swipes: await list("swipes") });
}

const Body = z.object({
  brandUrl: z.string().url().max(2048).nullable().optional(),
  url: z.string().url().max(2048).nullable().optional(),
  image: z.string().max(4_500_000).regex(/^data:image\/(png|jpe?g|webp);base64,/).nullable().optional(),
  note: z.string().trim().max(400).default(""),
});

/** Breaks a reference ad into its reusable structure (hook, beats, format) so concepts can borrow it without copying. */
async function analyse(image: string | null, pageText: string, note: string): Promise<{ structure: Swipe["structure"]; cost: number }> {
  if (!aiConfigured()) return { structure: { hook: note || "Reference hook", beats: ["hook", "proof", "cta"], format: "Reference", whyItWorks: "Demo analysis" }, cost: 0 };
  const parts: Part[] = [
    { type: "text", text: `Reference ad. Note from the marketer: ${note || "(none)"}\n${pageText ? `Ad page text: ${pageText.slice(0, 4000)}\n` : ""}Return JSON: {"hook": string (the opening line or visual, paraphrased), "beats": string[] (3-6 beats in order), "format": string (e.g. UGC testimonial, product demo, offer callout), "whyItWorks": string (one sentence)}` },
  ];
  if (image) parts.push({ type: "image_url", image_url: { url: image } });
  const { data, usage } = await chatJSON<NonNullable<Swipe["structure"]>>(DEFAULTS.vision, "You are a creative strategist reverse-engineering why an ad works. Describe structure, never copy names or slogans.", parts);
  return { structure: data, cost: usage.costUsd };
}

export async function POST(req: Request) {
  const user = await currentUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || (!parsed.data.url && !parsed.data.image && !parsed.data.note)) return NextResponse.json({ error: "Add an ad image, link or note" }, { status: 400 });
  const { brandUrl, url, image, note } = parsed.data;
  const id = newId("swipe");
  let pageText = "";
  if (url) pageText = await safeFetchText(url).then((h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, " ").replace(/\s+/g, " ")).catch(() => "");
  try {
    const { structure } = await analyse(image ?? null, pageText, note);
    const swipe: Swipe = { id, brandUrl: brandUrl ?? null, url: url ?? null, image: image ? await storeMedia(image, `swipes/${id}`) : null, note, structure, createdBy: user, createdAt: new Date().toISOString() };
    await put("swipes", swipe);
    return NextResponse.json({ swipe });
  } catch (e) {
    return NextResponse.json({ error: `Couldn't analyse that ad: ${(e as Error).message}` }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  if (!(await currentUser().catch(() => null))) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!(await get("swipes", id))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await remove("swipes", id);
  return NextResponse.json({ ok: true });
}
