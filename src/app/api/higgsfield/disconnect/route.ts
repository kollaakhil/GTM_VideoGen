import { NextResponse } from "next/server";
import { higgsfieldDisconnect } from "@/lib/higgsfield-mcp";

export async function POST() {
  await higgsfieldDisconnect();
  return NextResponse.json({ ok: true });
}
