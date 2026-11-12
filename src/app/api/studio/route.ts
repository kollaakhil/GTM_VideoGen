import { after, NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULTS, MODELS, providerConfigured, providerOf } from "@/lib/models";
import { brief, directions, diversityScores, filmstrip, organic, qa, render, research, styleDNA } from "@/lib/pipeline";
import { audioConfigured, transcribe, generateVideo, musicBed, nearest, openrouterCredits, videoDurations, videoPricePerSec, voiceover } from "@/lib/ai";
import { CATEGORIES, keyframe, planShots, QA_PASS, shotQA } from "@/lib/video-plan";
import { brandRules } from "@/lib/brand-rules";
import { STATIC_FORMATS, vocBlock, voiceOfCustomer } from "@/lib/ad-wisdom";
import { concepts, diversityIssues, selectDiverse } from "@/lib/concepts";
import { claimsCheck, gateVerdict } from "@/lib/gate";
import { learnings } from "@/lib/learnings";
import { checkScript, scriptLab, scriptSeconds, scriptText, textMatch, textRecall } from "@/lib/script-lab";
import { captionVariants, meanVolume, mediaDuration, spokenScript, stitchShots } from "@/lib/video-post";
import { get, list, mediaDataUrl, mediaFile, newId, put, storeMedia } from "@/lib/store";
import { currentUser } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import type { Brief, Creative, Direction, QAResult, RunEvent, Shot, ShotQA, StudioRun } from "@/lib/types";

export const maxDuration = 300;
const AUTO_FIX_ATTEMPTS = 2;
/** Static ads render this many takes per direction; vision QA keeps the best (cheap images, big quality gain). */
const TOURNAMENT_SIZE = Math.max(1, Math.min(4, Number(process.env.TOURNAMENT_SIZE) || 2));

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

const Plan = z.object({
  category: z.enum(["product_demo", "ugc_testimonial", "cinematic_lifestyle", "motion_graphics", "unboxing", "before_after", "problem_solution", "founder_story"]),
  lengthSec: z.number().int().min(4).max(60),
  draftModel: ModelId.optional(),
  finalModel: ModelId.optional(),
  voice: z.string().max(40).optional(),
  music: z.boolean().optional(),
  budgetUsd: z.number().min(0.5).max(500).optional(),
});

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("research"), brandUrl: z.string().url().max(2048), goal: Field(500).refine((g) => g.length >= 3, "Goal is too short"), format: z.enum(["static", "video"]), referenceUrl: z.string().url().max(2048).optional().or(z.literal("")), offer: z.string().trim().max(600).optional(), models: Models }),
  z.object({ action: z.literal("brief"), runId: z.string().max(64) }),
  z.object({ action: z.literal("edit_brief"), runId: z.string().max(64), brief: BriefSchema }),
  z.object({ action: z.literal("directions"), runId: z.string().max(64), format: z.enum(["static", "video"]).optional() }),
  z.object({ action: z.literal("generate"), runId: z.string().max(64), refs: Refs }),
  z.object({ action: z.literal("organic"), runId: z.string().max(64) }),
  z.object({ action: z.literal("concepts"), runId: z.string().max(64), format: z.enum(["static", "video"]).optional() }),
  z.object({ action: z.literal("pick_concepts"), runId: z.string().max(64), ids: z.array(z.string().max(16)).min(1).max(5) }),
  z.object({ action: z.literal("cancel"), runId: z.string().max(64) }),
  z.object({ action: z.literal("storyboard"), runId: z.string().max(64), directionId: z.string().max(32).optional(), plan: Plan, refs: Refs }),
  z.object({ action: z.literal("write_scripts"), runId: z.string().max(64), directionId: z.string().max(32).optional(), lengthSec: z.number().int().min(6).max(30).optional() }),
  z.object({
    action: z.literal("approve_script"),
    runId: z.string().max(64),
    directionId: z.string().max(32),
    scriptId: z.string().max(16),
    edit: z.object({ hook: z.string().trim().max(200).optional(), beats: z.array(z.object({ vo: z.string().trim().max(300), onScreen: z.string().trim().max(80) })).max(6).optional(), cta: z.string().trim().max(60).optional() }).optional(),
  }),
  z.object({ action: z.literal("redo_shot"), runId: z.string().max(64), directionId: z.string().max(32), shotId: z.string().max(8), visual: z.string().trim().min(5).max(800).optional(), refs: Refs }),
  z.object({ action: z.literal("render_video"), runId: z.string().max(64), directionId: z.string().max(32), tier: z.enum(["draft", "final"]), refs: Refs, draftModel: z.string().max(120).optional(), finalModel: z.string().max(120).optional() }),
  z.object({ action: z.literal("regenerate"), runId: z.string().max(64), directionId: z.string().max(32), refs: Refs }),
]);

const now = () => new Date().toISOString();
const say = (run: StudioRun, role: RunEvent["role"], text: string) => run.events.push({ at: now(), role, text });

// Jobs running in this server process. A run marked "working" whose job isn't here was cut off by a restart.
const jobs: Map<string, AbortController> = ((globalThis as { __studioJobs?: Map<string, AbortController> }).__studioJobs ??= new Map());
const live = (run: StudioRun) => !!run.jobId && jobs.has(run.jobId);

async function healOrphan(run: StudioRun) {
  if (run.status !== "working" || live(run)) return run;
  stopProgress(run);
  Object.assign(run, { status: "error", activity: null, jobId: null, job: null, updatedAt: now() });
  say(run, "error", "This step was interrupted (the server restarted mid-step). Run it again.");
  await put("studio_runs", run);
  return run;
}

function stopProgress(run: StudioRun) {
  for (const [k, v] of Object.entries(run.progress)) if (v !== "done" && v !== "failed") run.progress[k] = "failed";
}

export async function GET(req: Request) {
  const runId = new URL(req.url).searchParams.get("runId");
  if (runId) {
    const found = await get("studio_runs", runId);
    if (!found) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    const run = await healOrphan(found);
    const creatives = (await list("creatives")).filter((c) => c.runId === runId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return NextResponse.json({ run, creatives });
  }
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
    run = await healOrphan(found);
  }
  if (body.action === "cancel") {
    if (run.status !== "working") return NextResponse.json({ error: "Nothing is running" }, { status: 400 });
    if (run.jobId) {
      jobs.get(run.jobId)?.abort();
      jobs.delete(run.jobId);
    }
    stopProgress(run);
    Object.assign(run, { status: "idle", activity: null, jobId: null, job: null, updatedAt: now() });
    say(run, "agent", "Stopped. Anything already sent to a model provider may still be billed. Pick up from here whenever you're ready.");
    await put("studio_runs", run);
    return NextResponse.json({ run });
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

  if (body.action === "pick_concepts") {
    if (!run.concepts?.length) return NextResponse.json({ error: "Build the concept matrix first" }, { status: 400 });
    const ids = new Set(body.ids);
    const chosen = selectDiverse(run.concepts.map((c) => ({ ...c, selected: false })).filter((c) => ids.has(c.id)), ids.size);
    run.concepts = run.concepts.map((c) => ({ ...c, selected: ids.has(c.id), diversity: chosen.find((x) => x.id === c.id)?.diversity ?? c.diversity }));
    run.directions = [];
    const issues = diversityIssues(run.concepts.filter((c) => c.selected));
    say(run, issues.length ? "error" : "agent", issues.length ? `Diversity gate: ${issues.join("; ")}.` : `Picked ${ids.size} concept${ids.size === 1 ? "" : "s"}. They pass the diversity gate.`);
    run.updatedAt = now();
    await put("studio_runs", run);
    return NextResponse.json({ run });
  }

  const job = plan(run, body);
  if ("error" in job) return NextResponse.json({ error: job.error }, { status: 400 });
  const jobId = newId("job");
  jobs.set(jobId, new AbortController());
  run.status = "working";
  run.activity = job.activity;
  run.jobId = jobId;
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
      // Persist before releasing the job so a poll never sees "working" with no live job (would be healed as orphaned).
      if (jobs.has(jobId)) {
        Object.assign(run, { activity: null, jobId: null, job: null, updatedAt: now() });
        await put("studio_runs", run);
      }
      jobs.delete(jobId);
    }
  });
  return NextResponse.json({ run });
}

const brandName = (url: string) => {
  const host = new URL(url).hostname.replace(/^www\./, "").split(".")[0];
  return host.charAt(0).toUpperCase() + host.slice(1);
};

type Parsed = z.infer<typeof Body>;

function plan(run: StudioRun, body: Exclude<Parsed, { action: "edit_brief" | "cancel" | "pick_concepts" }>): { activity: string; work: () => Promise<void> } | { error: string } {
  const m = run.models;
  switch (body.action) {
    case "research":
      return {
        activity: "Researching the brand…",
        work: async () => {
          const [r, dna] = await Promise.all([research(m.text, run.brandUrl, goalCtx(run, brandRules(await brandFor(run)))), run.referenceUrl ? styleDNA(m.text, run.referenceUrl) : null]);
          const voc = await voiceOfCustomer(m.text, run.brandUrl, r.data).catch(() => null);
          if (!voc) say(run, "error", "Couldn't gather customer language from Reddit or reviews; continuing with site research only.");
          Object.assign(run, { research: r.data, voc: voc?.data ?? null, styleDNA: dna?.data ?? null, stage: "brief", costUsd: run.costUsd + r.cost + (dna?.cost ?? 0) + (voc?.cost ?? 0) });
          say(run, "agent", dna ? `Research is done, and I mapped ${dna.data.brand}'s creative style. Next: write the creative brief.` : "Research is done. Next: write the creative brief.");
        },
      };
    case "brief":
      if (!run.research) return { error: "Run research first" };
      return {
        activity: "Writing the brief…",
        work: async () => {
          const b = await brief(m.text, run.research!, goalCtx(run, (await guidance(run)) + vocBlock(run.voc)), run.styleDNA);
          Object.assign(run, { brief: b.data, stage: "directions", directions: [], concepts: [], costUsd: run.costUsd + b.cost });
          say(run, "agent", "Brief is ready. Edit it if you like, then approve it to build the concept matrix.");
        },
      };
    case "directions":
      if (!run.brief || !run.research) return { error: "Write the brief first" };
      if (body.format) run.format = body.format;
      return {
        activity: "Pitching three directions…",
        work: async () => {
          const picked = (run.concepts ?? []).filter((c) => c.selected);
          const d = await directions(m.text, run.brief!, run.research!, run.format, run.styleDNA, (await guidance(run)) + vocBlock(run.voc), picked);
          if (picked.length) d.data = d.data.slice(0, picked.length);
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
    case "concepts":
      if (!run.brief || !run.research) return { error: "Write the brief first" };
      if (body.format) run.format = body.format;
      return {
        activity: "Building the concept matrix…",
        work: async () => {
          const swipes = (await list("swipes")).filter((s) => !s.brandUrl || hostOf(s.brandUrl) === hostOf(run.brandUrl)).slice(0, 8);
          const formats = run.format === "video" ? Object.values(CATEGORIES).map((c) => c.label) : STATIC_FORMATS;
          const c = await concepts(m.text, { research: run.research!, brief: run.brief!, voc: run.voc, style: run.styleDNA, swipes, formats, rules: await guidance(run) });
          Object.assign(run, { concepts: c.data, directions: [], stage: "directions", costUsd: run.costUsd + c.cost });
          const issues = diversityIssues(c.data.filter((x) => x.selected));
          say(run, issues.length ? "error" : "agent", issues.length ? `Diversity gate: ${issues.join("; ")}. Pick different concepts or rebuild the matrix.` : `Built ${c.data.length} concepts and picked the 3 most distinct. Swap any, then turn them into directions.`);
        },
      };
    case "organic":
      if (!run.brief || !run.research) return { error: "Write the brief first" };
      return {
        activity: "Writing organic posts for Instagram, TikTok, LinkedIn and X…",
        work: async () => {
          const o = await organic(m.text, run.brief!, run.research!, run.styleDNA, await guidance(run));
          Object.assign(run, { organic: o.data, costUsd: run.costUsd + o.cost });
          say(run, "agent", "Organic posts are ready: Instagram, TikTok, LinkedIn, an X thread and a carousel.");
        },
      };
    case "storyboard": {
      if (!run.brief || !run.research || !run.directions.length) return { error: "Pitch directions first" };
      const p = body.plan;
      run.videoPlan = {
        category: p.category,
        lengthSec: p.lengthSec,
        draftModel: p.draftModel ?? "google/veo-3.1-lite",
        finalModel: p.finalModel ?? "google/veo-3.1-fast",
        voice: p.voice ?? "Rachel",
        music: p.music ?? true,
        budgetUsd: p.budgetUsd ?? 3,
      };
      const all = body.directionId ? run.directions.filter((d) => d.id === body.directionId) : run.directions;
      if (!all.length) return { error: "Direction not found" };
      const targets = run.format === "video" ? all.filter((d) => d.approvedScript) : all;
      if (!targets.length) return { error: "Approve a script first: run Write scripts, pick the best one per direction, then build the storyboard." };
      return {
        activity: `Storyboarding ${targets.length === 1 ? `“${targets[0].title}”` : `${targets.length} directions`}: shot list, keyframes and keyframe QA…`,
        work: async () => {
          run.job = { label: "Planning shot lists", done: 0, total: 0 };
          const res = await Promise.allSettled(targets.map((d) => storyboard(run, d, body.refs ?? [])));
          run.job = null;
          res.forEach((r, k) => {
            if (r.status === "rejected") {
              say(run, "error", `Storyboard for “${targets[k].title}” failed: ${String(r.reason?.message ?? r.reason).slice(0, 300)}`);
            }
          });
          say(run, "agent", "Storyboards are ready. Check the keyframes, redo or edit any shot, then render a draft video for the directions you like.");
        },
      };
    }
    case "write_scripts": {
      if (!run.brief || !run.research || !run.directions.length) return { error: "Pitch directions first" };
      const targets = body.directionId ? run.directions.filter((d) => d.id === body.directionId) : run.directions;
      if (!targets.length) return { error: "Direction not found" };
      const lengthSec = body.lengthSec ?? run.videoPlan?.lengthSec ?? 15;
      return {
        activity: `Script Lab: Sol is writing 5 scripts per direction, Carbon is grading them…`,
        work: async () => {
          run.job = { label: `Writing and grading scripts for ${targets.length} direction${targets.length === 1 ? "" : "s"}`, done: 0, total: targets.length };
          const [kit, rules] = await Promise.all([brandFor(run), guidance(run)]);
          const res = await Promise.allSettled(
            targets.map(async (d) => {
              const r = await scriptLab({ direction: d, brief: run.brief!, research: run.research!, voc: run.voc, style: run.styleDNA, rules, mustSay: kit?.mustSay, lengthSec });
              Object.assign(d, { scripts: r.scripts, approvedScript: null });
              run.costUsd += r.cost;
              if (run.job) run.job.done++;
              await saveRun(run);
              return r;
            }),
          );
          run.job = null;
          res.forEach((r, k) => {
            if (r.status === "rejected") say(run, "error", `Script Lab for “${targets[k].title}” failed: ${String(r.reason?.message ?? r.reason).slice(0, 300)}`);
          });
          const best = targets.filter((d) => d.scripts?.length).map((d) => d.scripts![0].score?.overall ?? 0);
          if (!best.length) return;
          say(run, "agent", `Scripts are ready (best scores ${best.join(", ")}/10). Edit any line, then approve one script per direction. Storyboards, voice and video only use approved scripts.`);
        },
      };
    }
    case "approve_script": {
      const d = run.directions.find((x) => x.id === body.directionId);
      const sc = d?.scripts?.find((x) => x.id === body.scriptId);
      if (!d || !sc) return { error: "Script not found" };
      return {
        activity: `Approving the ${sc.framework} script for “${d.title}”…`,
        work: async () => {
          const next = structuredClone(sc);
          if (body.edit?.hook) next.hook.spoken = body.edit.hook;
          if (body.edit?.cta) next.cta = body.edit.cta;
          body.edit?.beats?.forEach((b, i) => {
            if (next.beats[i]) Object.assign(next.beats[i], b);
          });
          const kit = await brandFor(run);
          next.checks = checkScript(next, scriptSeconds(next), kit?.mustSay);
          Object.assign(d, { approvedScript: next, script: scriptText(next), hook: next.hook.spoken || d.hook, shots: undefined });
          say(run, "agent", `Approved the ${next.framework} script for “${d.title}”${next.checks.length ? ` (heads-up: ${next.checks.join(" ")})` : ""}. Build its storyboard next.`);
        },
      };
    }
    case "redo_shot": {
      const d = run.directions.find((x) => x.id === body.directionId);
      const s = d?.shots?.find((x) => x.id === body.shotId);
      if (!d || !s || !run.videoPlan) return { error: "Shot not found" };
      if (body.visual) s.visual = body.visual;
      return {
        activity: `Redrawing shot ${Number(s.id.slice(1)) + 1} of “${d.title}”…`,
        work: async () => {
          await makeKeyframe(run, d, s, body.refs ?? []);
          say(run, "agent", `Redrew shot ${Number(s.id.slice(1)) + 1} (keyframe QA ${s.keyframeQa?.score}/10).`);
        },
      };
    }
    case "render_video": {
      const d = run.directions.find((x) => x.id === body.directionId);
      if (!d?.shots?.length || d.shots.some((s) => !s.keyframe) || !run.videoPlan) return { error: "Build the storyboard first" };
      for (const m of [body.draftModel, body.finalModel]) {
        if (m && !MODELS.some((x) => x.id === m && x.modality === "video" && providerConfigured(x.provider))) return { error: `Video model ${m} isn't available` };
      }
      if (body.draftModel) run.videoPlan.draftModel = body.draftModel;
      if (body.finalModel) run.videoPlan.finalModel = body.finalModel;
      return {
        activity: `Rendering the ${body.tier} video for “${d.title}”: ${d.shots.length} shots, shot QA, voice, music and final QA…`,
        work: async () => {
          const r = await renderVideo(run, d, body.tier, body.refs ?? []);
          run.stage = "qa";
          for (const w of r.warnings) say(run, "error", w);
          say(run, "agent", `Rendered the ${body.tier} video for “${d.title}”: final QA ${r.score}/10, $${r.spent.toFixed(2)}.${r.score >= QA_PASS ? "" : " Redo the weakest shots in the storyboard, or approve QA yourself if you disagree."}`);
        },
      };
    }
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

const goalCtx = (run: StudioRun, extra = "") =>
  (run.offer ? `${run.goal}\nReal offer terms (use exactly; never invent prices, discounts or shipping terms beyond these): ${run.offer}` : run.goal) + extra;

const hostOf = (u: string) => new URL(u).hostname.replace(/^www\./, "");

async function brandFor(run: StudioRun) {
  if (run.brandId) {
    const b = await get("brands", run.brandId);
    if (b) return b;
  }
  return (await list("brands")).find((b) => hostOf(b.url) === hostOf(run.brandUrl)) ?? null;
}

/** Brand-kit rules plus what past approvals, rejections and results taught us, for every generation prompt. */
async function guidance(run: StudioRun) {
  const [b, l] = await Promise.all([brandFor(run), learnings(run.brandUrl)]);
  return brandRules(b) + l.text;
}

const saveRun = async (run: StudioRun) => {
  if (!live(run)) throw new Error("Stopped");
  await put("studio_runs", { ...run, updatedAt: now() });
};

async function saveCreative(
  run: StudioRun,
  d: Direction,
  out: { url: string; type: "image" | "video"; model: string; variants?: { aspect: string; url: string }[] },
  q: QAResult,
  spent: number,
  diversity: number | null,
): Promise<void> {
  const stamp = Date.now();
  const mediaUrl = await storeMedia(out.url, `${run.id}/${d.id}-${stamp}`);
  const variants = await Promise.all(
    (out.variants ?? []).filter((v) => v.aspect !== "9:16").map(async (v) => ({ aspect: v.aspect, url: await storeMedia(v.url, `${run.id}/${d.id}-${stamp}-${v.aspect.replace(":", "x")}`) })),
  );
  const kit = await brandFor(run);
  const claims = await claimsCheck(run.models.text, {
    texts: [
      ...(d.format === "static" && process.env.STATIC_TYPESET !== "off" ? [`On-image text: ${d.copy?.metaHeadline || d.hook} / ${(kit?.offer || run.offer || run.brief?.offer || "").split(/[.;\n]/)[0].slice(0, 60)} / ${kit?.mustSay?.join(" · ") ?? ""}`] : []),d.hook, d.script, d.copy?.metaPrimaryText ?? "", d.copy?.metaHeadline ?? "", ...(d.copy?.googleHeadlines ?? []), ...(d.copy?.googleDescriptions ?? [])],
    research: run.research!, brief: run.brief!, offer: run.offer, mustSay: kit?.mustSay,
  }).catch(() => null);
  const gate = gateVerdict({ qa: q.score, diversity, unsupported: claims?.data.unsupported ?? [], missing: claims?.data.missing ?? [] });
  spent += claims?.cost ?? 0;
  run.costUsd += claims?.cost ?? 0;
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
    qa: q,
    qaOverride: null,
    diversity,
    status: "draft",
    channel: null,
    metrics: null,
    costUsd: spent,
    gate,
    conceptId: (run.concepts ?? []).filter((c) => c.selected)[run.directions.indexOf(d)]?.id ?? null,
    createdAt: now(),
  };
  if (!live(run)) return;
  await put("creatives", creative);
  for (const old of await list("creatives")) {
    if (old.runId === run.id && old.directionId === d.id && old.id !== creative.id && old.status === "draft") await put("creatives", { ...old, status: "rejected" });
  }
  run.creativeIds = [...run.creativeIds.filter((id) => id !== creative.id), creative.id];
  run.costUsd += spent;
  run.progress[d.id] = "done";
  await saveRun(run);
}

// Some models (e.g. Seedance) refuse first frames containing realistic people; fall back to one that accepts them.
const FACE_BLOCK = /SensitiveContent|PrivacyInformation/i;
const faceFallback = (model: string) => (model.includes("kling") ? "google/veo-3.1-fast" : "kwaivgi/kling-v3.0-std");

async function remember(run: StudioRun, s: Shot, kind: "keyframe" | "clip", model: string, q: ShotQA) {
  if (q.score < QA_PASS || !run.videoPlan) return;
  await put("prompt_library", { id: newId("pl"), category: run.videoPlan.category, kind, model, beat: s.beat, visual: s.visual, camera: s.camera, score: q.score, brandUrl: run.brandUrl, createdAt: now() });
}

async function winningShots(run: StudioRun) {
  const cat = run.videoPlan?.category;
  return (await list("prompt_library"))
    .filter((e) => e.category === cat)
    .sort((a, b) => (b.kind === "clip" ? 1 : 0) - (a.kind === "clip" ? 1 : 0) || b.score - a.score)
    .slice(0, 4);
}

const KEYFRAME_TRIES = 2;

async function makeKeyframe(run: StudioRun, d: Direction, s: Shot, refs: string[]) {
  const plan = run.videoPlan!;
  let best: { url: string; qa: { score: number; notes: string[] } } | null = null;
  let notes: string[] | undefined;
  for (let a = 0; a < KEYFRAME_TRIES; a++) {
    const img = await keyframe(run.models.image, s, plan.category, refs, run.research?.colors, notes);
    const q = await shotQA(run.models.vision, img.url, s, "keyframe", refs[0]);
    run.costUsd += img.usage.costUsd + q.cost;
    if (!best || q.qa.score > best.qa.score) best = { url: img.url, qa: q.qa };
    if (q.qa.score >= QA_PASS) break;
    notes = q.qa.notes;
  }
  await remember(run, s, "keyframe", run.models.image, best!.qa);
  Object.assign(s, { keyframe: await storeMedia(best!.url, `${run.id}/${d.id}-${s.id}-kf-${Date.now()}`), keyframeQa: best!.qa, clip: null, clipQa: null, status: "keyframe" });
  if (run.job) run.job.done++;
  await saveRun(run);
}

async function storyboard(run: StudioRun, d: Direction, refs: string[]) {
  const p = await planShots(run.models.text, d, run.brief!, run.research!, run.videoPlan!, run.styleDNA, await winningShots(run), await guidance(run));
  const durs = await videoDurations(run.videoPlan!.draftModel);
  d.shots = p.shots.map((s) => ({ ...s, seconds: nearest(durs, s.seconds) }));
  run.costUsd += p.cost;
  if (run.job) {
    run.job.total += d.shots.length;
    run.job.label = "Drawing keyframes and running keyframe QA";
  }
  await saveRun(run);
  await Promise.all(d.shots.map((s) => makeKeyframe(run, d, s, refs)));
}

const SILENT_DB = -50;

async function step(run: StudioRun, d: Direction, label: string, done: number, total: number) {
  run.job = { directionId: d.id, label, done, total };
  await saveRun(run);
}

/**
 * Preflight (keyframes, budget, credits, voice + music made and checked) runs before any paid video;
 * then shots render one at a time under the budget cap, are QA'd, stitched, mixed and QA'd again.
 */
async function renderVideo(run: StudioRun, d: Direction, tier: "draft" | "final", refs: string[]) {
  const plan = run.videoPlan!;
  const chosen = tier === "final" ? plan.finalModel : plan.draftModel;
  let model = chosen;
  const shots = d.shots!;
  const tries = tier === "final" ? 2 : 1;
  const resolution = tier === "final" ? "1080p" : "480p";
  const withAudio = audioConfigured();
  const total = shots.length + 4;
  const warnings: string[] = [];
  const noSpend = "No video credits were spent.";
  let spent = 0;

  await step(run, d, "Preflight: keyframes, budget and credits", 0, total);
  const weak = shots.filter((s) => !s.keyframe || (s.keyframeQa?.score ?? 0) < 6);
  if (weak.length) throw new Error(`Preflight: redraw shot ${weak.map((s) => Number(s.id.slice(1)) + 1).join(", ")} first (keyframe QA under 6/10). ${noSpend}`);
  const durs = await videoDurations(model);
  for (const s of shots) s.seconds = nearest(durs, s.seconds);
  const seconds = shots.reduce((t, s) => t + s.seconds, 0);
  const perSec = (await videoPricePerSec(model, resolution, !withAudio)) ?? 0.12;
  const expected = seconds * perSec + shots.length * 0.01 + (withAudio ? 0.02 + (plan.music ? 0.6 : 0) : 0);
  if (expected > plan.budgetUsd) throw new Error(`Preflight: this ${tier} video is estimated at $${expected.toFixed(2)} (${seconds}s on ${model}), above your $${plan.budgetUsd} cap. Shorten it, pick a cheaper model or raise the cap. ${noSpend}`);
  const credits = providerOf(model) === "openrouter" ? await openrouterCredits() : null;
  if (credits != null && credits < expected * 1.2) throw new Error(`Preflight: your OpenRouter balance is $${credits.toFixed(2)}, below this video's estimate of $${expected.toFixed(2)}. Add credits at openrouter.ai/settings/credits or pick a cheaper model. ${noSpend}`);

  const starts = shots.map((_, i) => shots.slice(0, i).reduce((t, s) => t + s.seconds, 0));
  const voices: { url: string; start: number; tempo?: number }[] = [];
  let music: string | null = null;
  if (withAudio) {
    await step(run, d, "Voiceover and music, checked before any video is generated", 1, total);
    const lines = shots.map((s) => spokenScript(s.vo));
    if (!lines.some(Boolean)) throw new Error(`Preflight: the storyboard has no spoken lines. Rebuild it. ${noSpend}`);
    const vo = await Promise.all(lines.map((l) => (l ? voiceWithCheck(l, plan.voice) : null))).catch((e: Error) => {
      throw new Error(`Preflight: ${e.message.slice(0, 220)}. ${noSpend}`);
    });
    for (const [i, v] of vo.entries()) {
      if (!v) continue;
      spent += v.usage.costUsd;
      const [len, db] = await Promise.all([mediaDuration(v.url), meanVolume(v.url)]);
      if (len < 0.3 || db < SILENT_DB) throw new Error(`Preflight: the voiceover for shot ${i + 1} came back silent. ${noSpend}`);
      const room = shots[i].seconds - 0.3;
      if (len > room * 1.5) warnings.push(`Shot ${i + 1}'s line is too long for ${shots[i].seconds}s and will be cut; shorten it in the storyboard.`);
      voices.push({ url: v.url, start: starts[i] + 0.15, tempo: len > room ? len / room : undefined });
    }
    if (plan.music) {
      try {
        const mu = await musicBed(`Instrumental bed for a ${CATEGORIES[plan.category].label.toLowerCase()} video ad. Mood: ${run.research?.tone ?? "modern, upbeat"}. Clean, modern, builds to a lift near the end, no vocals.`, seconds + 2);
        spent += mu.usage.costUsd;
        if ((await meanVolume(mu.url)) < SILENT_DB) warnings.push("The music bed came back silent, so the video uses voice only.");
        else music = mu.url;
      } catch (e) {
        warnings.push(`Music failed (${(e as Error).message.slice(0, 120)}), so the video uses voice only.`);
      }
    }
  }

  for (const [i, s] of shots.entries()) {
    s.status = "rendering";
    s.attempts = 0;
    const first = await mediaDataUrl(s.keyframe!);
    let notes: string[] = [];
    let best: { url: string; qa: { score: number; notes: string[] } } | null = null;
    while (s.attempts < tries) {
      if (spent + s.seconds * perSec > plan.budgetUsd) {
        if (best) break;
        throw new Error(`Budget cap of $${plan.budgetUsd} reached at shot ${i + 1} ($${spent.toFixed(2)} spent). Raise the cap or shorten the video.`);
      }
      s.attempts++;
      await step(run, d, `Shot ${i + 1}/${shots.length}: ${s.attempts > 1 ? "retrying from QA notes" : "rendering"} on ${model}`, 2 + i, total);
      const prompt = `${s.visual}
Camera: ${s.camera}. Look: ${CATEGORIES[plan.category].look}.
Start exactly from the given first frame and keep the product, people and setting consistent. Natural, physically plausible motion, no morphing. No text, captions, logos or price tags appear.${!withAudio && s.vo ? `\nSpoken line: "${s.vo}"` : ""}${notes.length ? `\nFix from the last take: ${notes.join(" ")}` : ""}`;
      const vopts = { firstFrame: first, seconds: s.seconds, audio: !withAudio, resolution };
      const v = await generateVideo(model, prompt, vopts).catch(async (e: Error) => {
        if (!FACE_BLOCK.test(e.message)) throw e;
        if (model === chosen) {
          model = faceFallback(chosen);
          warnings.push(`${chosen} refuses first frames with realistic people, so this video switched to ${model}.`);
        }
        return generateVideo(model, prompt, vopts);
      });
      const sheet = await filmstrip(v.url);
      const q = await shotQA(run.models.vision, sheet.sheet, s, "clip", refs[0]);
      spent += v.usage.costUsd + q.cost;
      if (!best || q.qa.score > best.qa.score) best = { url: v.url, qa: q.qa };
      if (q.qa.score >= QA_PASS) break;
      notes = q.qa.notes;
    }
    await remember(run, s, "clip", model, best!.qa);
    Object.assign(s, { clip: await storeMedia(best!.url, `${run.id}/${d.id}-${s.id}-clip-${Date.now()}`), clipQa: best!.qa, status: "done" });
    await saveRun(run);
  }

  await step(run, d, "Stitching shots, mixing audio, captions and end card", 2 + shots.length, total);
  const clips = await Promise.all(shots.map((s) => mediaDataUrl(s.clip!)));
  const st = await stitchShots(clips, { voices, music });
  if ((voices.length || !withAudio) && (await meanVolume(st.url)) < SILENT_DB) {
    if (voices.length) throw new Error("The mixed video came out silent, so it was not saved. Try the render again; if it repeats, this is a bug.");
    warnings.push(`${model} returned no audio for this video.`);
  }
  const segments = shots.map((s, i) => ({ start: st.starts[i], end: st.starts[i + 1] ?? st.duration, text: s.vo }));
  const kit = await brandFor(run);
  const end = {
    brand: kit?.name && !kit.name.includes(".") ? kit.name : run.research?.brand || brandName(run.brandUrl),
    line: d.copy?.metaHeadline,
    cta: d.approvedScript?.cta?.replace(/[.!]+$/, "") || d.copy?.metaCta,
    color: kit?.colorRoles?.primary || run.research?.colors?.[0],
    logo: kit?.logo ? await mediaDataUrl(kit.logo).catch(() => null) : null,
    fontFile: kit?.font?.file ? await mediaFile(kit.font.file).catch(() => null) : null,
    fontFamily: kit?.font?.family ?? null,
  };
  const variants = await captionVariants(st.url, "", end, segments).catch((e) => {
    warnings.push(`Captions and extra sizes failed (${(e as Error).message.slice(0, 100)}).`);
    return [];
  });
  const main = variants.find((x) => x.aspect === "9:16")?.url ?? st.url;

  await step(run, d, "Final QA on the filmstrip", 3 + shots.length, total);
  const q = await qa(run.models.vision, main, "video", run.brief!, d.hook, shots.map((s) => s.vo).join(" "));
  spent += q.cost;
  if (withAudio) {
    const m = await scriptMatch(st.url, segments).catch((e: Error) => ({ error: e.message }));
    if ("error" in m) warnings.push(`Script match check failed (${m.error.slice(0, 100)}).`);
    else {
      q.data.notes.unshift(`Script match: ${Math.round(m.overall * 100)}% of the approved script is heard; per shot ${m.perShot.map((x) => `${Math.round(x * 100)}%`).join(", ")}`);
      const off = m.perShot.flatMap((x, i) => (x < 0.8 ? [i + 1] : []));
      if (m.overall < 0.9 || off.length) {
        q.data.notes.unshift(`The voiceover drifts from the approved script${off.length ? ` in shot ${off.join(", ")}` : ""}.`);
        q.data.score = Math.min(q.data.score, QA_PASS - 1);
        q.data.pass = false;
      }
    }
  }
  await saveCreative(run, d, { url: main, type: "video", model, variants }, q.data, spent, null);
  run.job = null;
  return { score: q.data.score, spent, warnings };
}

/** Voiceover that is transcribed back and must match its script line before any video is rendered. */
async function voiceWithCheck(line: string, voice: string) {
  let last = 0, said = "";
  for (let i = 0; i < 2; i++) {
    const v = await voiceover(line, voice);
    const heard = await transcribe(v.url).catch(() => null);
    if (!heard) return v;
    last = textMatch(heard.text, line);
    said = heard.text.trim();
    if (last >= 0.85) return v;
  }
  throw new Error(`the voiceover didn't say the approved line. Script: "${line.slice(0, 80)}", heard: "${said.slice(0, 80)}" (${Math.round(last * 100)}% match after 2 tries). Reword the line in the Script Lab and approve it again`);
}

/** Speech-to-text on the stitched video, aligned to each shot's window, compared with the approved lines. */
async function scriptMatch(video: string, segments: { start: number; end: number; text: string }[]) {
  const t = await transcribe(video);
  const perShot = segments.map((s) => {
    if (!s.text.trim()) return 1;
    const heard = t.chunks.filter((c) => c.end > s.start - 0.4 && c.start < s.end + 0.4).map((c) => c.text).join(" ");
    return textRecall(heard, s.text);
  });
  return { overall: textMatch(t.text, segments.map((s) => s.text).join(" ")), perShot };
}

async function generateMany(run: StudioRun, dirs: Direction[], refs: string[]) {
  const m = run.models;
  const div = diversityScores(run.directions.map((d) => `${d.angle} ${d.visualPrompt}`));
  const kit = await brandFor(run);
  const staticKit = process.env.STATIC_TYPESET === "off" ? null : {
    brand: kit?.name && !kit.name.includes(".") ? kit.name : run.research?.brand || brandName(run.brandUrl),
    offer: (kit?.offer || run.offer || run.brief?.offer || "").split(/[.;\n]/)[0].slice(0, 60) || null,
    primary: kit?.colorRoles?.primary || run.research?.colors?.[0] || null,
    footer: kit?.mustSay?.length ? kit.mustSay.join(" · ") : null,
    logo: kit?.logo ? await mediaDataUrl(kit.logo).catch(() => null) : null,
    fontFile: kit?.font?.file ? await mediaFile(kit.font.file).catch(() => null) : null,
    fontFamily: kit?.font?.family ?? null,
  };
  const save = async () => {
    if (!live(run)) throw new Error("Stopped");
    await put("studio_runs", { ...run, updatedAt: now() });
  };
  const results = await Promise.allSettled(
    dirs.map(async (d) => {
      const i = run.directions.indexOf(d);
      const opts = { imageModel: m.image, videoModel: m.video, refs, seed: i, brand: run.research?.brand || brandName(run.brandUrl), style: { styleRef: run.research?.styleRef, colors: run.research?.colors }, kit: staticKit };
      run.progress[d.id] = "rendering";
      await save();
      const takes = d.format === "static" ? TOURNAMENT_SIZE : 1;
      const candidates = await Promise.all(Array.from({ length: takes }, (_, t) => render(d, { ...opts, seed: i * 10 + t })));
      run.progress[d.id] = "qa";
      await save();
      const graded = await Promise.all(candidates.map(async (c) => ({ out: c, q: await qa(m.vision, c.url, c.type, run.brief!, d.hook) })));
      graded.sort((a, b) => b.q.data.score - a.q.data.score);
      let { out, q } = graded[0];
      let spent = graded.reduce((n, g) => n + g.out.cost + g.q.cost, 0);
      if (takes > 1) q = { ...q, data: { ...q.data, notes: [`Best of ${takes} takes (scores ${graded.map((g) => g.q.data.score).join(", ")})`, ...q.data.notes] } };
      for (let a = 0; a < AUTO_FIX_ATTEMPTS && !q.data.pass && out.type === "image"; a++) {
        run.progress[d.id] = "fixing";
        await save();
        const retry = await render(d, { ...opts, seed: i * 10 + takes + a, fixes: q.data.notes });
        const rq = await qa(m.vision, retry.url, retry.type, run.brief!, d.hook);
        spent += retry.cost + rq.cost;
        if (rq.data.score >= q.data.score) {
          q = { ...rq, data: { ...rq.data, notes: [`Auto-fixed after QA (was ${q.data.score}/10)`, ...rq.data.notes] } };
          out = retry;
        }
      }
      await saveCreative(run, d, out, q.data, spent, div[i] ?? null);
    }),
  );
  results.forEach((r, k) => {
    if (r.status === "rejected") {
      run.progress[dirs[k].id] = "failed";
      say(run, "error", `“${dirs[k].title}” failed: ${String(r.reason?.message ?? r.reason).slice(0, 300)}`);
    }
  });
}
