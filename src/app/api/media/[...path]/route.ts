import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { mediaPath } from "@/lib/store";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", webm: "video/webm" };

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const rel = (await params).path.join("/");
  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  if (!TYPES[ext]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const buf = await fs.readFile(mediaPath(rel));
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": TYPES[ext], "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
