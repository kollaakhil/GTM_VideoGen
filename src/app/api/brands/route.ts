import { NextResponse } from "next/server";
import { z } from "zod";
import { list, newId, put, storeMedia } from "@/lib/store";
import { currentUser } from "@/lib/session";

export async function GET() {
  const brands = (await list("brands")).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json({ brands });
}

const Img = z.string().max(4_500_000).regex(/^(data:image\/(png|jpe?g|webp);base64,|\/api\/media\/)/);
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/).optional();
const Lines = z.array(z.string().trim().min(1).max(200)).max(12).optional();

const Kit = z.object({
  url: z.string().url().max(2048),
  name: z.string().trim().max(80).optional(),
  offer: z.string().trim().max(600).optional(),
  photos: z.array(z.string().max(4_500_000).regex(/^data:image\/(png|jpe?g|webp);base64,/)).max(4).optional(),
  logo: Img.nullable().optional(),
  font: z.object({ family: z.string().trim().min(1).max(60).regex(/^[\w -]+$/), file: z.string().max(3_000_000).regex(/^(data:(font\/(ttf|otf)|application\/(x-font-ttf|x-font-otf|octet-stream|font-sfnt));base64,|\/api\/media\/)/) }).nullable().optional(),
  colorRoles: z.object({ primary: Hex, accent: Hex, background: Hex, text: Hex }).partial().nullable().optional(),
  voice: z.string().trim().max(300).optional(),
  audience: z.string().trim().max(300).optional(),
  toneExamples: Lines,
  dos: Lines,
  donts: Lines,
  winners: z.array(z.object({ image: Img.nullable().optional(), note: z.string().trim().min(1).max(300) })).max(6).optional(),
});

export async function POST(req: Request) {
  if (!(await currentUser().catch(() => null))) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const parsed = Kit.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid brand kit" }, { status: 400 });
  const { url, name, offer, photos, logo, font, colorRoles, voice, audience, toneExamples, dos, donts, winners } = parsed.data;
  const host = new URL(url).hostname.replace(/^www\./, "");
  const existing = (await list("brands")).find((b) => new URL(b.url).hostname.replace(/^www\./, "") === host);
  const id = existing?.id ?? newId("brand");
  const save = (media: string, key: string) => storeMedia(media, `brands/${id}/${key}-${Date.now()}`);
  const fontFile = font ? (font.file.startsWith("data:") ? await save(font.file.replace(/^data:[^;]+;/, "data:font/ttf;"), "font") : font.file) : undefined;
  const brand = await put("brands", {
    id,
    name: name || existing?.name || host,
    url,
    voice: voice ?? existing?.voice ?? "",
    audience: audience ?? existing?.audience ?? "",
    colors: existing?.colors ?? [],
    offer: offer ?? existing?.offer ?? "",
    photos: photos ?? existing?.photos ?? [],
    logo: logo === undefined ? (existing?.logo ?? null) : logo ? await save(logo, "logo") : null,
    font: font === undefined ? (existing?.font ?? null) : font ? { family: font.family, file: fontFile! } : null,
    colorRoles: colorRoles === undefined ? (existing?.colorRoles ?? null) : colorRoles,
    toneExamples: toneExamples ?? existing?.toneExamples ?? [],
    dos: dos ?? existing?.dos ?? [],
    donts: donts ?? existing?.donts ?? [],
    winners: winners ? await Promise.all(winners.map(async (w, i) => ({ note: w.note, image: w.image ? await save(w.image, `winner${i}`) : null }))) : (existing?.winners ?? []),
    createdAt: new Date().toISOString(),
  });
  return NextResponse.json({ brand });
}
