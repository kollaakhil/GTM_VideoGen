import { NextResponse } from "next/server";
import { readMedia } from "@/lib/store";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav" };

// Supports HTTP Range requests: Safari/iOS won't play <video> without 206 responses, and seeking needs them everywhere.
export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const rel = (await params).path.join("/");
  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  if (!TYPES[ext]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let buf: Buffer | null;
  try {
    buf = await readMedia(rel);
  } catch {
    buf = null;
  }
  if (!buf) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const headers: Record<string, string> = {
    "Content-Type": TYPES[ext],
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };
  const m = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return new NextResponse(new Uint8Array(buf), { headers: { ...headers, "Content-Length": String(buf.length) } });
  const size = buf.length;
  let start = m[1] ? Number(m[1]) : size - Number(m[2]);
  let end = m[1] && m[2] ? Number(m[2]) : size - 1;
  start = Math.max(0, start);
  end = Math.min(size - 1, end);
  if (start > end || start >= size) return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  return new NextResponse(new Uint8Array(buf.subarray(start, end + 1)), {
    status: 206,
    headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
  });
}
