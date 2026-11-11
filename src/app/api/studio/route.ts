import { after, NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULTS } from "@/lib/models";
import { brief, directions, diversityScores, organic, qa, render, research, styleDNA } from "@/lib/pipeline";
import { get, list, newId, put, storeMedia } from "@/lib/store";
import { currentUser } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import type { Brief, Creative, Direction, RunEvent, StudioRun } from "@/lib/types";

export const maxDuration = 300;
const AUTO_FIX_ATTEMPTS = 1;

const ModelId = z.string().max(120).regex(/^[\w./:-]+$/);
const Models = z.object({ text: ModelId, vision: ModelId, image: ModelId, video: ModelId }).partial().optional();
const Ref = z.string().max(7_000_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, "Product photos must be PNG, JPEG or WebP");
const Refs = z.array(Ref).max(4).optional();
const Field = (n: number) => z.string().trim().min(1).max(n);
const BriefSchema = z.object({
  objective: Field(400),
  audience: Field(400),
  insight: Field(400),
  offer: Field(300),
  mandatories: z.array(Field(200)).min(1).max(8),
  kpi: Field(200),
});

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("research"), brandUrl: z.string().url().max(2048), goal: Field(500).refine((g) => g.length >= 3, "Goal is too short"), format: z.enum(["static", "video"]), referenceUrl: z.string().url().max(2048).optional().or(z.literal("")), offer: z.string().trim().max(600).optional(), models: Models }),
  z.object({ action: z.literal("brief"), runId: z.string().max(64) }),
  z.object({ action: z.literal("edit_brief"), runId: z.string().max(64), brief: BriefSchema }),
  z.object({ action: z.literal("directions"), runId: z.string().max(64), format: z.enum(["static", "video"]).optional() }),
  z.object({ action: z.literal("generate"), runId: z.string().max(64), refs: Refs }),
  z.object({ action: z.literal("organic"), runId: z.string().max(64) }),
  z.object({ action: z.literal("regenerate"), runId: z.string().max(64), directionId: z.string().max(32), refs: Refs }),
]);

const now = () => new Date().toISOString();
const say = (run: StudioRun, role: RunEvent["role"], text: string) => run.events.push({ at: now(), role, text });

export async function GET(req: Request) {
  const runId = new URL(req.url).searchParams.get("runId");
  if (runId) {
    const run = await get("studio_runs", runId);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    const creatives = (await list("creatives")).filter((c) => c.runId === runId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return NextResponse.json({ run, creatives });
  }
  const runs = (await list("studio_runs")).slice(0, 50).map((r) => ({ id: r.id, brandUrl: r.brandUrl, goal: r.goal, stage: r.stage, status: r.status, costUsd: r.costUsd, createdAt: r.createdAt }));
  return NextResponse.json({ runs });
}

export async function POST(req: Request) {
  let user: string;
  try {
    user = await currentUser();
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!rateLimit(`studio:${user}`, 40, 10 * 60_000)) return NextResponse.json({ error: "Too many requests. Wait a few minutes." }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const body = parsed.data;

  let run: StudioRun;
  if (body.action === "research") {
    run = {
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
      referenceUrl: body.referenceUrl || null,
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
  } else {
    const found = await get("studio_runs", body.runId);
    if (!found) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    run = found;
  }
  if (run.status === "working") return NextResponse.json({ error: "This run is already working on a step" }, { status: 409 });

  if (body.action === "edit_brief") {
    if (!run.brief) return NextResponse.json({ error: "No brief to edit yet" }, { status: 400 });
    run.brief = body.brief as Brief;
    run.stage = "directions";
    run.directions = [];
    say(run, "agent", "Saved your edits to the brief. Approve it when you're ready for directions.");
    run.updatedAt = now();
    await put("studio_runs", run);
    return NextResponse.json({ run });
  }

  const job = plan(run, body);
  if ("error" in job) return NextResponse.json({ error: job.error }, { status: 400 });
  run.status = "working";
  run.activity = job.activity;
  run.updatedAt = now();
  await put("studio_runs", run);

  after(async () => {
    try {
      await job.work();
      run.status = "idle";
    } catch (e) {
      run.status = "error";
      say(run, "error", `${job.activity.replace("…", "")} failed: ${(e as Error).message}`);
    } finally {
      run.activity = null;
      run.updatedAt = now();
      await put("studio_runs", run);
    }
  });
  return NextResponse.json({ run });
}

type Parsed = z.infer<typeof Body>;

function plan(run: StudioRun, body: Exclude<Parsed, { action: "edit_brief" }>): { activity: string; work: () => Promise<void> } | { error: string } {
  const m = run.models;
  switch (body.action) {
    case "research":
      return {
        activity: "Researching the brand…",
        work: async () => {
          const [r, dna] = await Promise.all([research(m.text, run.brandUrl, goalCtx(run)), run.referenceUrl ? styleDNA(m.text, run.referenceUrl) : null]);
          Object.assign(run, { research: r.data, styleDNA: dna?.data ?? null, stage: "brief", costUsd: run.costUsd + r.cost + (dna?.cost ?? 0) });
          say(run, "agent", dna ? `Research is done, and I mapped ${dna.data.brand}'s creative style. Next: write the creative brief.` : "Research is done. Next: write the creative brief.");
        },
      };
    case "brief":
      if (!run.research) return { error: "Run research first" };
      return {
        activity: "Writing the brief…",
        work: async () => {
          const b = await brief(m.text, run.research!, goalCtx(run), run.styleDNA);
          Object.assign(run, { brief: b.data, stage: "directions", directions: [], costUsd: run.costUsd + b.cost });
          say(run, "agent", "Brief is ready. Edit it if you like, then approve it to get three directions.");
        },
      };
    case "directions":
      if (!run.brief || !run.research) return { error: "Write the brief first" };
      if (body.format) run.format = body.format;
      return {
        activity: "Pitching three directions…",
        work: async () => {
          const d = await directions(m.text, run.brief!, run.research!, run.format, run.styleDNA);
          Object.assign(run, { directions: d.data, stage: "generate", progress: {}, costUsd: run.costUsd + d.cost });
          say(run, "agent", "Here are three directions. Generate creatives when you're happy, or re-pitch.");
        },
      };
    case "generate":
      if (!run.brief || !run.directions.length) return { error: "Pitch directions first" };
      return {
        activity: `Generating ${run.directions.length} ${run.format === "video" ? "videos" : "images"} and running Vision QA…`,
        work: async () => {
          run.creativeIds = [];
          run.progress = Object.fromEntries(run.directions.map((d) => [d.id, "queued" as const]));
          await generateMany(run, run.directions, body.refs ?? []);
          const made = run.creativeIds.length;
          if (made === 0) {
            say(run, "error", "None of the creatives could be generated. Check the errors above, switch the model under Models if needed, and generate again.");
            return;
          }
          run.stage = "qa";
          say(run, "agent", `Generated ${made} creative${made === 1 ? "" : "s"}. Ones that pass QA can be sent to the Inbox for publishing.`);
        },
      };
    case "organic":
      if (!run.brief || !run.research) return { error: "Write the brief first" };
      return {
        activity: "Writing organic posts for Instagram, TikTok, LinkedIn and X…",
        work: async () => {
          const o = await organic(m.text, run.brief!, run.research!, run.styleDNA);
          Object.assign(run, { organic: o.data, costUsd: run.costUsd + o.cost });
          say(run, "agent", "Organic posts are ready: Instagram, TikTok, LinkedIn, an X thread and a carousel.");
        },
      };
    case "regenerate": {
      const d = run.directions.find((x) => x.id === body.directionId);
      if (!d) return { error: "Direction not found" };
      return {
        activity: `Regenerating “${d.title}”…`,
        work: async () => {
          run.progress[d.id] = "queued";
          await generateMany(run, [d], body.refs ?? []);
          say(run, "agent", `Regenerated “${d.title}”.`);
        },
      };
    }
  }
}

const goalCtx = (run: StudioRun) =>
  run.offer ? `${run.goal}\nReal offer terms (use exactly; never invent prices, discounts or shipping terms beyond these): ${run.offer}` : run.goal;

async function generateMany(run: StudioRun, dirs: Direction[], refs: string[]) {
  const m = run.models;
  const div = diversityScores(run.directions.map((d) => `${d.angle} ${d.visualPrompt}`));
  const save = () => put("studio_runs", { ...run, updatedAt: now() });
  const results = await Promise.allSettled(
    dirs.map(async (d) => {
      const i = run.directions.indexOf(d);
      const opts = { imageModel: m.image, videoModel: m.video, refs, seed: i, style: { styleRef: run.research?.styleRef, colors: run.research?.colors } };
      run.progress[d.id] = "rendering";
      await save();
      let out = await render(d, opts);
      run.progress[d.id] = "qa";
      await save();
      let q = await qa(m.vision, out.url, out.type, run.brief!, d.hook);
      let spent = out.cost + q.cost;
      for (let a = 0; a < AUTO_FIX_ATTEMPTS && !q.data.pass && out.type === "image"; a++) {
        run.progress[d.id] = "fixing";
        await save();
        const retry = await render(d, { ...opts, fixes: q.data.notes });
        const rq = await qa(m.vision, retry.url, retry.type, run.brief!, d.hook);
        spent += retry.cost + rq.cost;
        if (rq.data.score >= q.data.score) {
          q = { ...rq, data: { ...rq.data, notes: [`Auto-fixed after QA (was ${q.data.score}/10)`, ...rq.data.notes] } };
          out = retry;
        }
      }
      const stamp = Date.now();
      const mediaUrl = await storeMedia(out.url, `${run.id}/${d.id}-${stamp}`);
      const variants = await Promise.all(
        (out.variants ?? []).filter((v) => v.aspect !== "9:16").map(async (v) => ({ aspect: v.aspect, url: await storeMedia(v.url, `${run.id}/${d.id}-${stamp}-${v.aspect.replace(":", "x")}`) })),
      );
      const creative: Creative = {
        id: newId("cr"),
        runId: run.id,
        directionId: d.id,
        copy: d.copy ?? null,
        title: d.title,
        hook: d.hook,
        angle: d.angle,
        format: d.format,
        mediaUrl,
        variants,
        mediaType: out.type,
        model: out.model,
        qa: q.data,
        qaOverride: null,
        diversity: div[i] ?? null,
        status: "draft",
        channel: null,
        metrics: null,
        costUsd: spent,
        createdAt: now(),
      };
      await put("creatives", creative);
      for (const old of await list("creatives")) {
        if (old.runId === run.id && old.directionId === d.id && old.id !== creative.id && old.status === "draft") await put("creatives", { ...old, status: "rejected" });
      }
      run.creativeIds = [...run.creativeIds.filter((id) => id !== creative.id), creative.id];
      run.costUsd += spent;
      run.progress[d.id] = "done";
      await save();
    }),
  );
  results.forEach((r, k) => {
    if (r.status === "rejected") {
      run.progress[dirs[k].id] = "failed";
      say(run, "error", `“${dirs[k].title}” failed: ${String(r.reason?.message ?? r.reason).slice(0, 300)}`);
    }
  });
}
