import { NextResponse } from "next/server";
import { currentUser } from "@/lib/session";
import { STAGES, STAGE_DEFAULTS, defaultFor } from "@/lib/registry";
import { clientModels } from "@/lib/registry/ready";

/** The model registry for the pickers: every model, whether its provider is connected, and the best default per stage. */
export async function GET() {
  try {
    await currentUser();
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const defaults = Object.fromEntries(Object.keys(STAGE_DEFAULTS).map((s) => [s, defaultFor(s as keyof typeof STAGE_DEFAULTS)]));
  return NextResponse.json({ stages: STAGES, defaults, models: clientModels() });
}
