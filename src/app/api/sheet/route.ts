import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/session";
import { list, put, storeMedia } from "@/lib/store";
import { rateLimit } from "@/lib/rate-limit";
import { PRODUCT_PHOTO_PATTERN } from "@/lib/quality-policy";
import { applySheetEdit, newSheetRun, runBrief, runSheet } from "@/lib/sheet/flow";
import { healSheetRun, loadRun, saveProgress, startSheetJob } from "@/lib/sheet/jobs";
import { sheetActions } from "@/lib/sheet/actions";

export const maxDuration = 300;

const Url = z.string().trim().url().max(500);
const Create = z.object({
  action: z.literal("create"),
  brandUrl: Url, brand: z.string().trim().max(60).optional(), goal: z.string().trim().min(3).max(600), offer: z.string().trim().max(300).optional(),
  facts: z.string().trim().max(6000).optional(), inspirationUrl: z.union([Url, z.literal("")]).optional(),
  photos: z.array(z.string().max(7_000_000).regex(PRODUCT_PHOTO_PATTERN)).max(4).optional(),
  targetSec: z.number().min(6).max(60).optional(), aspect: z.enum(["16:9", "9:16", "1:1"]).optional(), audioMode: z.enum(["vo", "foley"]).optional(),
  capUsd: z.number().min(0).max(25).optional(),
});
const Brief = z.object({ objective: z.string().max(300), audience: z.string().max(300), insight: z.string().max(400), offer: z.string().max(300), mandatories: z.array(z.string().max(160)).max(8), kpi: z.string().max(160) });
const Body = z.discriminatedUnion("action", [
  Create,
  z.object({ action: z.literal("edit_brief"), runId: z.string().max(40), brief: Brief, facts: z.string().max(6000).optional() }),
  z.object({ action: z.literal("sheet"), runId: z.string().max(40) }),
  z.object({ action: z.literal("edit_sheet"), runId: z.string().max(40), sheet: z.unknown() }),
  z.object({ action: z.literal("set_cap"), runId: z.string().max(40), capUsd: z.number().min(0).max(25) }),
]);

export async function GET(req: Request) {
  try {
    await currentUser();
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const p = new URL(req.url).searchParams;
  const id = p.get("id");
  if (id) {
    const run = await loadRun(id);
    return run ? NextResponse.json({ run: await healSheetRun(run) }) : NextResponse.json({ error: "Run not found" }, { status: 404 });
  }
  const runs = (await list("sheet_runs")).slice(0, 50).map((r) => ({ id: r.id, brand: r.input.brand, goal: r.input.goal, step: r.step, status: r.status, spent: r.cost.spentUsd, createdAt: r.createdAt, final: r.final?.score ?? null }));
  return NextResponse.json({ runs });
}

export async function POST(req: Request) {
  let user: string;
  try {
    user = await currentUser();
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!rateLimit(`sheet:${user}`, 60, 10 * 60_000)) return NextResponse.json({ error: "Too many requests. Wait a few minutes." }, { status: 429 });
  const raw = await req.json().catch(() => null);
  const extra = await sheetActions(raw, user);
  if (extra) return extra;
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const b = parsed.data;

  if (b.action === "create") {
    const run = newSheetRun({ ...b, photos: [] }, user);
    run.input.photos = await Promise.all((b.photos ?? []).map((ph, i) => storeMedia(ph, `${run.id}/photo-${i}`)));
    await startSheetJob(run, "Researching the brand and writing the brief…", runBrief);
    return NextResponse.json({ run });
  }
  const found = await loadRun(b.runId);
  if (!found) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const run = await healSheetRun(found);
  if (run.status === "working") return NextResponse.json({ error: "This run is already working on a step." }, { status: 409 });
  if (b.action === "edit_brief") {
    run.brief = b.brief;
    if (b.facts !== undefined) run.input.facts = b.facts;
    await saveProgress(run);
    return NextResponse.json({ run });
  }
  if (b.action === "set_cap") {
    run.cost.capUsd = b.capUsd;
    await saveProgress(run);
    return NextResponse.json({ run });
  }
  if (b.action === "edit_sheet") {
    const r = applySheetEdit(run, b.sheet);
    if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
    await put("sheet_runs", run);
    return NextResponse.json({ run });
  }
  if (!run.brief) return NextResponse.json({ error: "Write the brief first." }, { status: 400 });
  await startSheetJob(run, "Writing the script and shot sheet…", (r) => runSheet(r));
  return NextResponse.json({ run });
}
