import { NextResponse } from "next/server";
import { DEFAULTS } from "@/lib/models";
import { get, list, newId } from "@/lib/store";
import type { StudioRun } from "@/lib/types";
import type { Parsed } from "./schema";
import { healOrphan, now, say } from "./run-state";

/** GET /api/studio?runId=…: one run (healed if its job was cut off) plus its creatives. */
export async function runResponse(runId: string) {
  const found = await get("studio_runs", runId);
  if (!found) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  const run = await healOrphan(found);
  const creatives = (await list("creatives")).filter((c) => c.runId === runId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return NextResponse.json({ run, creatives });
}

/** GET /api/studio: the 200 most recent runs as history summaries. */
export async function runListResponse() {
  const creatives = await list("creatives");
  const byRun = new Map<string, { url: string; type: "image" | "video"; n: number; passed: number }>();
  for (const c of creatives) {
    const t = byRun.get(c.runId);
    if (!t) byRun.set(c.runId, { url: c.mediaUrl, type: c.mediaType, n: 1, passed: c.qa?.pass ? 1 : 0 });
    else Object.assign(t, { n: t.n + 1, passed: t.passed + (c.qa?.pass ? 1 : 0) });
  }
  const runs = (await list("studio_runs")).slice(0, 200).map((r) => {
    const t = byRun.get(r.id);
    const kf = r.directions.flatMap((d) => d.shots ?? []).find((s) => s.keyframe)?.keyframe ?? null;
    return {
      id: r.id,
      brandUrl: r.brandUrl,
      goal: r.goal,
      stage: r.stage,
      status: r.status,
      format: r.format,
      costUsd: r.costUsd,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      thumb: t ? { url: t.url, type: t.type } : kf ? { url: kf, type: "image" as const } : null,
      creatives: t?.n ?? 0,
      passed: t?.passed ?? 0,
    };
  });
  return NextResponse.json({ runs });
}

/** A fresh run for the "research" action. */
export function newRun(body: Extract<Parsed, { action: "research" }>, user: string): StudioRun {
  const run: StudioRun = {
    id: newId("run"),
    brandUrl: body.brandUrl,
    goal: body.goal,
    format: body.format,
    models: { ...DEFAULTS, ...(body.models ?? {}) },
    stage: "research",
    status: "idle",
    activity: null,
    events: [],
    progress: {},
    research: null,
    // A direct video or image link is broken down as an inspiration, not fetched as a style page.
    referenceUrl: body.referenceUrl || body.inspirations?.find((i) => i.url && !/\.(mp4|mov|webm|m4v|png|jpe?g|webp|gif)(\?|#|$)/i.test(i.url))?.url || null,
    autoBrief: body.autoBrief ?? false,
    offer: body.offer || null,
    styleDNA: null,
    brief: null,
    directions: [],
    creativeIds: [],
    costUsd: 0,
    createdBy: user,
    createdAt: now(),
    updatedAt: now(),
  };
  say(run, "user", `${body.brandUrl}\n${body.goal}`);
  return run;
}
