import { NextResponse } from "next/server";
import { z } from "zod";
import { list, newId, put } from "@/lib/store";
import { currentUser } from "@/lib/session";

export async function GET() {
  const brands = (await list("brands")).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json({ brands });
}

const Kit = z.object({
  url: z.string().url().max(2048),
  name: z.string().trim().max(80).optional(),
  offer: z.string().trim().max(600).optional(),
  photos: z.array(z.string().max(4_500_000).regex(/^data:image\/(png|jpe?g|webp);base64,/)).max(4).optional(),
});

export async function POST(req: Request) {
  if (!(await currentUser().catch(() => null))) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const parsed = Kit.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid brand kit" }, { status: 400 });
  const { url, name, offer, photos } = parsed.data;
  const host = new URL(url).hostname.replace(/^www\./, "");
  const existing = (await list("brands")).find((b) => new URL(b.url).hostname.replace(/^www\./, "") === host);
  const brand = await put("brands", {
    id: existing?.id ?? newId("brand"),
    name: name || existing?.name || host,
    url,
    voice: existing?.voice ?? "",
    audience: existing?.audience ?? "",
    colors: existing?.colors ?? [],
    offer: offer ?? existing?.offer ?? "",
    photos: photos ?? existing?.photos ?? [],
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ brand });
}
