import { NextResponse } from "next/server";

/**
 * Hook for the render pipeline: previews, final and picks are handled here once it lands. Until then they answer 501
 * so Studio can say so plainly.
 */
export async function sheetActions(raw: unknown, _user: string): Promise<Response | null> {
  const a = (raw as { action?: string } | null)?.action;
  if (a === "previews" || a === "final" || a === "pick") return NextResponse.json({ error: "Rendering isn't wired into this build yet (it ships with the render pipeline PR)." }, { status: 501 });
  return null;
}
