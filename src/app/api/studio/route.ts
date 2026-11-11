import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULTS } from "@/lib/models";
import { brief, directions, diversityScores, qa, render, research } from "@/lib/pipeline";
import { get, newId, put, storeMedia } from "@/lib/store";
import type { Creative, StudioRun } from "@/lib/types";

export const maxDuration = 300;

const Models = z
  .object({ text: z.string(), vision: z.string(), image: z.string(), video: z.string() })
  .partial()
  .optional();

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("research"), brandUrl: z.string().url(), goal: z.string().min(3), models: Models }),
  z.object({ action: z.literal("brief"), runId: z.string(), models: Models }),
  z.object({ action: z.literal("directions"), runId: z.string(), format: z.enum(["static", "video"]), models: Models }),
  z.object({ action: z.literal("generate"), runId: z.string(), refs: z.array(z.string()).max(4).optional(), models: Models }),
]);

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const body = parsed.data;
  const m = { ...DEFAULTS, ...(body.models ?? {}) };

  try {
    if (body.action === "research") {
      const r = await research(m.text, body.brandUrl, body.goal);
      const run: StudioRun = {
        id: newId("run"),
        brandUrl: body.brandUrl,
        goal: body.goal,
        stage: "brief",
        research: r.data,
        brief: null,
        directions: [],
        creativeIds: [],
        costUsd: r.cost,
        createdAt: new Date().toISOString(),
      };
      await put("studio_runs", run);
      return NextResponse.json({ run });
    }

    const run = await get("studio_runs", body.runId);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    if (body.action === "brief") {
      if (!run.research) throw new Error("Run research first");
      const b = await brief(m.text, run.research, run.goal);
      Object.assign(run, { brief: b.data, stage: "directions", costUsd: run.costUsd + b.cost });
    } else if (body.action === "directions") {
      if (!run.brief || !run.research) throw new Error("Write the brief first");
      const d = await directions(m.text, run.brief, run.research, body.format);
      Object.assign(run, { directions: d.data, stage: "generate", costUsd: run.costUsd + d.cost });
    } else {
      if (!run.brief || !run.directions.length) throw new Error("Pick directions first");
      const div = diversityScores(run.directions.map((d) => `${d.angle} ${d.visualPrompt}`));
      const results = await Promise.allSettled(
        run.directions.map(async (d, i) => {
          const out = await render(d, { imageModel: m.image, videoModel: m.video, refs: body.refs ?? [], seed: i });
          const mediaUrl = await storeMedia(out.url, `${run.id}/${d.id}.png`);
          const q = await qa(m.vision, out.url, out.type, run.brief!, d.hook);
          const creative: Creative = {
            id: newId("cr"),
            runId: run.id,
            title: d.title,
            hook: d.hook,
            angle: d.angle,
            format: d.format,
            mediaUrl,
            mediaType: out.type,
            model: out.model,
            qa: q.data,
            diversity: div[i],
            status: "draft",
            channel: null,
            metrics: null,
            costUsd: out.cost + q.cost,
            createdAt: new Date().toISOString(),
          };
          await put("creatives", creative);
          return creative;
        }),
      );
      const creatives = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      const errors = results.flatMap((r) => (r.status === "rejected" ? [String(r.reason?.message ?? r.reason)] : []));
      Object.assign(run, {
        creativeIds: creatives.map((c) => c.id),
        stage: "qa",
        costUsd: run.costUsd + creatives.reduce((s, c) => s + c.costUsd, 0),
      });
      await put("studio_runs", run);
      return NextResponse.json({ run, creatives, errors });
    }
    await put("studio_runs", run);
    return NextResponse.json({ run });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
