import { after, NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { DEFAULTS, MODELS, providerConfigured, providerOf } from "@/lib/models";
import { brief, directions, diversityScores, organic, qa, render, research, styleDNA } from "@/lib/pipeline";
import { audioConfigured, transcribe, generateVideo, musicBed, openrouterCredits, videoDurations, videoPricePerSec, voiceover } from "@/lib/ai";
import { CATEGORIES, keyframe, planShots, QA_PASS, reviewShotFrames } from "@/lib/video-plan";
import { brandRules } from "@/lib/brand-rules";
import { STATIC_FORMATS, vocBlock, voiceOfCustomer } from "@/lib/ad-wisdom";
import { concepts, diversityIssues, selectDiverse } from "@/lib/concepts";
import { claimsCheck, gateVerdict } from "@/lib/gate";
import { learnings } from "@/lib/learnings";
import { checkScript, judgeFor, reviewScript, sameSpeech, SCRIPT_JUDGES, SCRIPT_WRITERS, scriptLab, scriptSeconds, scriptText, WRITER, writerLabel } from "@/lib/script-lab";
import { SCRIPT_PASS, scriptReady, shotReady, videoAspects, videoReady } from "@/lib/quality-policy";
import { captionVariants, END_SECONDS, expectedCopy, meanVolume, mediaDuration, stitchShots } from "@/lib/video-post";
import { audioFindings, checkExport, evidenceFrames, exportVerdict, frameTimes, localOcrAvailable, reusableShot, transcribeLine, verifySpeech, videoTechnicalFindings } from "@/lib/media-qa";
import { get, list, mediaDataUrl, mediaFile, newId, put, storeMedia } from "@/lib/store";
import { currentUser } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import type { Brief, Creative, Direction, QAResult, RunEvent, Shot, ShotQA, StudioRun, VideoQuality } from "@/lib/types";

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
  z.object({ action: z.literal("write_scripts"), runId: z.string().max(64), directionId: z.string().max(32).optional(), lengthSec: z.number().int().min(6).max(30).optional(), writer: z.enum(SCRIPT_WRITERS).optional(), judge: z.enum(SCRIPT_JUDGES).optional() }),
  z.object({
    action: z.literal("approve_script"),
    runId: z.string().max(64),
    directionId: z.string().max(32),
    scriptId: z.string().max(64),
    edit: z.object({ hook: z.string().trim().max(300).optional(), beats: z.array(z.object({ vo: z.string().trim().max(300), onScreen: z.string().trim().max(160) })).max(6).optional(), cta: z.string().trim().max(60).optional() }).optional(),
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
      if (run.directions.some((d) => d.format === "video")) return { error: "Videos must go through Script Lab and the storyboard before rendering." };
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
        draftModel: p.draftModel ?? "hfmcp:seedance1_5",
        finalModel: p.finalModel ?? "hfmcp:kling3_0",
        voice: p.voice ?? "Rachel",
        music: p.music ?? true,
        budgetUsd: p.budgetUsd ?? 3,
      };
      const all = body.directionId ? run.directions.filter((d) => d.id === body.directionId) : run.directions;
      if (!all.length) return { error: "Direction not found" };
      const targets = all.filter((d) => d.format === "video" && scriptReady(d.approvedScript));
      if (!targets.length) return { error: `Approve an independently graded ${SCRIPT_PASS}/10 script before building a storyboard.` };
      return {
        activity: `Storyboarding ${targets.length === 1 ? `“${targets[0].title}”` : `${targets.length} directions`}: shot list, keyframes and keyframe QA…`,
        work: async () => {
          run.job = { label: "Planning shot lists", done: 0, total: 0 };
          const kit = await brandFor(run);
          const productRefs = body.refs?.length ? body.refs : kit?.photos ?? [];
          if (!productRefs.length) throw new Error("Upload at least one real product photo before storyboarding.");
          const savedRefs = await Promise.all(productRefs.map((img, i) => storeMedia(img, `${run.id}/ref-${i}-${createHash("sha256").update(img).digest("hex").slice(0, 16)}`)));
          const res = await Promise.allSettled(targets.map((d) => storyboard(run, d, productRefs, savedRefs, kit?.mustSay)));
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
        activity: `Script Lab: ${writerLabel(body.writer)} is writing 5 scripts per direction, ${writerLabel(judgeFor(body.writer, body.judge))} is grading them…`,
        work: async () => {
          run.job = { label: `Writing and grading scripts for ${targets.length} direction${targets.length === 1 ? "" : "s"}`, done: 0, total: targets.length };
          const [kit, rules] = await Promise.all([brandFor(run), guidance(run)]);
          if (!run.voc) {
            const voc = await voiceOfCustomer(run.models.text, run.brandUrl, run.research!).catch(() => null);
            if (voc) Object.assign(run, { voc: voc.data, costUsd: run.costUsd + voc.cost });
          }
          const res = await Promise.allSettled(
            targets.map(async (d) => {
              const r = await scriptLab({ direction: d, brief: run.brief!, research: run.research!, voc: run.voc, style: run.styleDNA, rules, mustSay: kit?.mustSay, lengthSec }, { writer: body.writer, judge: judgeFor(body.writer, body.judge) });
              Object.assign(d, { scripts: r.scripts });
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
        activity: `Checking the ${sc.framework} script for “${d.title}”…`,
        work: async () => {
          let next = structuredClone(sc);
          if (body.edit?.hook !== undefined && next.beats[0]) next.beats[0].vo = body.edit.hook;
          if (body.edit?.cta !== undefined) next.cta = body.edit.cta;
          body.edit?.beats?.forEach((b, i) => {
            if (next.beats[i]) Object.assign(next.beats[i], b);
          });
          if (body.edit && next.beats[0]) Object.assign(next.hook, { spoken: next.beats[0].vo, onScreen: next.beats[0].onScreen });
          const changed = JSON.stringify([next.hook, next.beats, next.cta]) !== JSON.stringify([sc.hook, sc.beats, sc.cta]);
          const kit = await brandFor(run);
          const targetSeconds = sc.review?.targetSeconds ?? run.videoPlan?.lengthSec ?? scriptSeconds(next);
          next.checks = checkScript(next, targetSeconds, kit?.mustSay);
          if (changed) {
            next.score = undefined;
            next.review = undefined;
            d.scripts = d.scripts!.map((s) => s.id === sc.id ? next : s);
            if (d.approvedScript?.id === sc.id) Object.assign(d, { approvedScript: null, shots: undefined, passingDraft: null, storyboardKey: null });
            await saveRun(run);
          }
          if (!next.checks.length && (changed || !next.review || !next.score)) {
            if (!run.brief || !run.research) throw new Error("Brand research and a brief are required to review this script.");
            const result = await reviewScript(next, { direction: d, brief: run.brief, research: run.research, voc: run.voc, style: run.styleDNA, rules: brandRules(kit), mustSay: kit?.mustSay, lengthSec: targetSeconds }, sc.review?.writer ?? WRITER, sc.review?.judge);
            next = result.script;
            run.costUsd += result.cost;
          }
          d.scripts = d.scripts!.map((s) => s.id === sc.id ? next : s);
          if (!scriptReady(next)) {
            say(run, "error", `Script not approved. ${next.checks?.join(" ") || `Independent review: ${next.score?.overall ?? "ungraded"}/10. The script needs ${SCRIPT_PASS}/10 with no unsupported claims.`}`);
            return;
          }
          if (JSON.stringify(d.approvedScript) !== JSON.stringify(next)) Object.assign(d, { approvedScript: next, script: scriptText(next), hook: next.hook.spoken, shots: undefined, passingDraft: null, storyboardKey: null });
          say(run, "agent", `Approved the ${next.framework} script (${next.score!.overall}/10). Build its storyboard next.`);
        },
      };
    }
    case "redo_shot": {
      const d = run.directions.find((x) => x.id === body.directionId);
      const s = d?.shots?.find((x) => x.id === body.shotId);
      if (!d || !s || !run.videoPlan || !d.storyboardKey || !scriptReady(d.approvedScript)) return { error: "Build a storyboard for an approved script first." };
      return {
        activity: `Redrawing shot ${Number(s.id.slice(1)) + 1} of “${d.title}”…`,
        work: async () => {
          const productRefs = await Promise.all((d.productRefs ?? []).map(mediaDataUrl));
          if (!productRefs.length) throw new Error("The storyboard has no locked product references. Rebuild it.");
          d.storyboardKey = randomUUID();
          d.passingDraft = null;
          if (body.visual) s.visual = body.visual;
          s.keyframeQa = null;
          await saveRun(run);
          const verdict = await makeKeyframe(run, d, s, productRefs);
          say(run, "agent", `Redrew shot ${Number(s.id.slice(1)) + 1} (keyframe QA ${verdict.score}/10, ${verdict.match}).`);
        },
      };
    }
    case "render_video": {
      const d = run.directions.find((x) => x.id === body.directionId);
      if (!d?.shots?.length || d.shots.some((s) => !s.keyframe) || !run.videoPlan || !d.storyboardKey || !scriptReady(d.approvedScript)) return { error: "Build a storyboard from a passing script before rendering." };
      if (body.tier === "final" && d.passingDraft !== d.storyboardKey) return { error: "Pass draft QA for this storyboard before upgrading to HD." };
      for (const m of [body.draftModel, body.finalModel]) {
        if (m && !MODELS.some((x) => x.id === m && x.modality === "video" && providerConfigured(x.provider))) return { error: `Video model ${m} isn't available` };
      }
      if (body.draftModel) run.videoPlan.draftModel = body.draftModel;
      if (body.finalModel) run.videoPlan.finalModel = body.finalModel;
      return {
        activity: `Rendering the ${body.tier} video for “${d.title}”: ${d.shots.length} shots, shot QA, voice, music and final QA…`,
        work: async () => {
          const r = await renderVideo(run, d, body.tier);
          run.stage = "qa";
          for (const w of r.warnings) say(run, "error", w);
          say(run, "agent", `Saved the ${body.tier} for “${d.title}”: QA ${r.quality.status}, ${r.quality.score}/10, $${r.spent.toFixed(2)}.${videoReady(r.quality) ? "" : " Open the timestamped report for fixes."}`);
        },
      };
    }
    case "regenerate": {
      const d = run.directions.find((x) => x.id === body.directionId);
      if (!d) return { error: "Direction not found" };
      if (d.format === "video") return { error: "Use the storyboard render controls to repair or rerender this video." };
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
  out: { url: string; type: "image" | "video"; model: string; variants?: { aspect: string; url: string }[]; quality?: VideoQuality },
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
      ...(d.format === "static" && process.env.STATIC_TYPESET !== "off" ? [`On-image text: ${d.copy?.metaHeadline || d.hook} / ${(kit?.offer || run.offer || run.brief?.offer || "").split(/[.;\n]/)[0].slice(0, 60)} / ${kit?.mustSay?.join(" · ") ?? ""}`] : []),
      ...(out.quality ? out.quality.shots.flatMap((s) => [s.vo, s.onScreen]) : [d.hook, d.script]),
      d.copy?.metaPrimaryText ?? "", d.copy?.metaHeadline ?? "", ...(d.copy?.googleHeadlines ?? []), ...(d.copy?.googleDescriptions ?? []),
    ],
    research: run.research!, brief: run.brief!, offer: run.offer, mustSay: kit?.mustSay,
  }).catch(() => null);
  const gate = gateVerdict({ qa: q.score, diversity, unsupported: claims?.data.unsupported ?? [], missing: claims?.data.missing ?? [] });
  if (out.quality) {
    if (!claims) gate.reasons.push("Claims review could not be completed.");
    if (!videoReady(out.quality)) gate.reasons.push("Video needs passing script-match and export evidence.");
    if (out.quality.tier !== "final") gate.reasons.push("Approve a verified HD export, not a draft.");
    gate.pass = !gate.reasons.length;
  }
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
    quality: out.quality,
    qaOverride: null,
    diversity,
    status: "draft",
    channel: null,
    metrics: null,
    costUsd: spent + (claims?.cost ?? 0),
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
  run.costUsd += (out.quality ? 0 : spent) + (claims?.cost ?? 0);
  run.progress[d.id] = "done";
  await saveRun(run);
}

async function remember(run: StudioRun, s: Shot, kind: "keyframe" | "clip", model: string, q: ShotQA) {
  if (!shotReady(q) || !run.videoPlan) return;
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

async function makeKeyframe(run: StudioRun, d: Direction, s: Shot, refs: string[]): Promise<ShotQA> {
  const plan = run.videoPlan!;
  let best: { url: string; qa: ShotQA } | null = null;
  let notes: string[] | undefined;
  for (let a = 0; a < KEYFRAME_TRIES; a++) {
    if (!live(run)) throw new Error("Stopped before generating a keyframe.");
    const img = await keyframe(run.models.image, s, plan.category, refs, run.research?.colors, notes);
    const q = await reviewShotFrames(run.models.vision, [{ at: 0, url: img.url }], s, refs, undefined, "keyframe");
    run.costUsd += img.usage.costUsd + q.cost;
    if (!best || shotReady(q.qa) || (!shotReady(best.qa) && q.qa.score > best.qa.score)) best = { url: img.url, qa: q.qa };
    if (shotReady(q.qa) || q.qa.match === "review") break;
    notes = [...q.qa.notes, ...(q.qa.frames ?? []).filter((f) => f.match === "fail").map((f) => f.note)];
  }
  await remember(run, s, "keyframe", run.models.image, best!.qa);
  Object.assign(s, { keyframe: await storeMedia(best!.url, `${run.id}/${d.id}-${s.id}-kf-${Date.now()}`), keyframeQa: best!.qa, clip: null, clipQa: null, status: "keyframe" });
  if (run.job) run.job.done++;
  await saveRun(run);
  return best!.qa;
}

async function storyboard(run: StudioRun, d: Direction, refs: string[], savedRefs: string[], mustSay?: string[]) {
  const issues = checkScript(d.approvedScript!, run.videoPlan!.lengthSec, mustSay);
  if (issues.length) throw new Error(issues.join(" "));
  const p = await planShots(run.models.text, d, run.brief!, run.research!, run.videoPlan!, run.styleDNA, await winningShots(run), await guidance(run));
  Object.assign(d, { shots: p.shots, productRefs: savedRefs, storyboardKey: randomUUID(), passingDraft: null, compactCopy: false });
  run.costUsd += p.cost;
  if (run.job) {
    run.job.total += p.shots.length;
    run.job.label = "Drawing keyframes and running keyframe QA";
  }
  await saveRun(run);
  await Promise.all(p.shots.map((s) => makeKeyframe(run, d, s, refs)));
}

const SILENT_DB = -50;

async function step(run: StudioRun, d: Direction, label: string, done: number, total: number) {
  if (!live(run)) throw new Error("Stopped before the next production step.");
  run.job = { directionId: d.id, label, done, total };
  await saveRun(run);
}

/**
 * Preflight (keyframes, budget, credits, voice + music made and checked) runs before any paid video;
 * then shots render one at a time under the budget cap, are QA'd, stitched, mixed and QA'd again.
 */
async function renderVideo(run: StudioRun, d: Direction, tier: "draft" | "final") {
  const plan = run.videoPlan!;
  const model = tier === "final" ? plan.finalModel : plan.draftModel;
  const provider = providerOf(model);
  const shots = d.shots!;
  const resolution = tier === "final" ? "1080p" : "480p";
  const aspects = videoAspects(tier);
  const total = shots.length + 4;
  const warnings: string[] = [];
  let spent = 0;
  const charge = (cost: number) => { spent += cost; run.costUsd += cost; };

  await step(run, d, "Preflight: script, references, QA tools and budget", 0, total);
  const kit = await brandFor(run);
  const issues = checkScript(d.approvedScript!, plan.lengthSec, kit?.mustSay);
  if (issues.length) throw new Error(issues.join(" "));
  if (!audioConfigured()) throw new Error("Connect fal.ai for separate, verified voiceover before rendering.");
  if (!await localOcrAvailable()) throw new Error("Video QA requires local Tesseract and its configured language. No video was requested.");
  const weak = shots.filter((s) => !s.keyframe || !shotReady(s.keyframeQa));
  if (weak.length) throw new Error(`Redraw keyframes ${weak.map((s) => Number(s.id.slice(1)) + 1).join(", ")} until each matches the approved shot and scores ${QA_PASS}/10. No video was requested.`);
  const refs = await Promise.all((d.productRefs ?? []).slice(0, 2).map(mediaDataUrl));
  if (!refs.length) throw new Error("Rebuild the storyboard with real product references.");
  const durs = (await videoDurations(model))?.filter((n) => n > 0).sort((a, b) => a - b);
  const seconds = shots.reduce((t, s) => t + s.seconds, 0);
  const actual = shots.map((s) => durs?.length ? durs.find((n) => n >= s.seconds) : s.seconds);
  if (actual.some((s) => s === undefined)) throw new Error("The chosen model cannot cover a locked beat. Pick a model with longer takes.");
  const cacheKeys = shots.map((s) => shortHash(["video-qa-v1", resolution, model, plan.category, d.productRefs, s.keyframe, s.expectedVisual, s.visual, s.camera, s.seconds]));
  const toReview = (s: Shot, i: number) => s.clipKey === cacheKeys[i] && !!s.clip && (!s.clipQa || s.clipQa.match === "review");
  const missing = shots.flatMap((s, i) => reusableShot(s, cacheKeys[i]) || toReview(s, i) ? [] : [i]);
  const perSec = provider === "hfmcp" ? 0 : (await videoPricePerSec(model, resolution, false)) ?? 0.12;
  const musicKey = shortHash([plan.category, seconds, run.research?.tone]);
  const reserve = 0.12 + shots.length * 0.035 + (plan.music && d.musicTrack?.key !== musicKey ? 0.6 : 0);
  const dollars = missing.map((i) => actual[i]! * perSec);
  const estimated = dollars.reduce((a, b) => a + b, reserve);
  if (estimated > plan.budgetUsd) throw new Error(`Preflight: estimated $${estimated.toFixed(2)} exceeds the $${plan.budgetUsd} cap. No video was requested.`);
  const router = await openrouterCredits();
  if (router == null || router < Math.max(0.05, provider === "openrouter" ? estimated * 1.1 : 0.05)) {
    throw new Error("OpenRouter's balance or spending budget is too low for the required review. Check Credits and Guardrails.");
  }

  let hfLeft = 0;
  const quotes = new Map<number, number>();
  if (provider === "hfmcp" && missing.length) {
    const { higgsfieldCredits, higgsfieldVideoCost } = await import("@/lib/higgsfield-mcp");
    const hf = model.replace(/^hfmcp:/, "");
    const [left, costs] = await Promise.all([higgsfieldCredits(), Promise.all(missing.map((i) => higgsfieldVideoCost(hf, { seconds: actual[i], resolution })))]);
    if (left == null || costs.some((c) => c == null || !Number.isFinite(c) || c <= 0)) throw new Error("Higgsfield did not confirm the balance and per-shot quote. No video was requested.");
    hfLeft = left;
    missing.forEach((i, j) => quotes.set(i, costs[j]!));
    const need = costs.reduce<number>((a, b) => a + b!, 0);
    if (hfLeft < need) throw new Error(`Higgsfield needs ${need.toFixed(1)} credits for the remaining shots; ${hfLeft.toFixed(1)} are available.`);
    say(run, "agent", `Higgsfield quote: ${need.toFixed(1)} credits for ${missing.length} remaining shots. Subscription retries are off; use Repair to authorize another take.`);
  }

  await step(run, d, "Verifying each voiceover before motion spend", 1, total);
  let start = 0;
  const voices: { url: string; start: number; tempo?: number }[] = [];
  for (const [i, s] of shots.entries()) {
    if (!live(run)) throw new Error("Stopped before the next voiceover.");
    const line = s.vo.trim();
    if (line) {
      const key = shortHash([line, plan.voice, s.seconds]);
      if (s.voiceTrack?.key !== key) {
        const voice = await checkedVoice(line, plan.voice, charge);
        const [len, db] = await Promise.all([mediaDuration(voice), meanVolume(voice)]);
        const room = s.seconds - 0.3;
        if (len < 0.3 || db < SILENT_DB || len > room * 1.3) throw new Error(`Voice for shot ${i + 1} is silent or too long for the approved beat. Shorten the script and review it again; no video was requested.`);
        s.voiceTrack = { key, url: await storeMedia(voice, `${run.id}/${d.id}-voice-${i}-${key}`), tempo: len > room ? len / room : undefined };
        await saveRun(run);
      }
      voices.push({ url: await mediaDataUrl(s.voiceTrack.url), start: start + 0.15, tempo: s.voiceTrack.tempo });
    }
    start += s.seconds;
  }
  let music: string | null = null;
  if (plan.music) {
    if (!live(run)) throw new Error("Stopped before music production.");
    try {
      if (d.musicTrack?.key !== musicKey) {
        const mu = await musicBed(`Clean instrumental for a ${CATEGORIES[plan.category].label}, ${run.research?.tone ?? "modern"} tone, no vocals.`, seconds + 2);
        charge(mu.usage.costUsd);
        if (await meanVolume(mu.url) < SILENT_DB) throw new Error("silent music bed");
        d.musicTrack = { key: musicKey, url: await storeMedia(mu.url, `${run.id}/${d.id}-music-${musicKey}`) };
        await saveRun(run);
      }
      music = await mediaDataUrl(d.musicTrack.url);
    } catch {
      throw new Error("The selected music bed is unavailable or silent. No video was requested. Retry or disable music in the video plan.");
    }
  }

  const firsts = await Promise.all(shots.map((s) => mediaDataUrl(s.keyframe!)));
  const assess = async (video: string, s: Shot, i: number): Promise<ShotQA> => {
    try {
      const technical = await videoTechnicalFindings(video, s.seconds, undefined, plan.category !== "motion_graphics");
      if (technical.length) {
        return { score: 0, match: technical.some((f) => f.status === "fail") ? "fail" : "review", notes: technical.map((f) => `${f.at.toFixed(2)}s: ${f.observed}`) };
      }
      const frames = await evidenceFrames(video, frameTimes(0, s.seconds), { start: 0, end: s.seconds });
      const review = await reviewShotFrames(run.models.vision, frames, s, refs, firsts[i]);
      charge(review.cost);
      return review.qa;
    } catch {
      return { score: 0, match: "review", notes: ["The saved take could not be visually verified."] };
    }
  };
  const recordTake = async (s: Shot, url: string, verdict: ShotQA) => {
    Object.assign(s, { clip: url, clipQa: verdict, status: shotReady(verdict) ? "done" : "failed" });
    await saveRun(run);
    await remember(run, s, "clip", model, verdict);
  };
  const qCostReserve = 0.08 + shots.length * 0.025;
  for (const [i, s] of shots.entries()) {
    if (reusableShot(s, cacheKeys[i])) continue;
    if (toReview(s, i)) {
      await step(run, d, `Shot ${i + 1}/${shots.length}: verifying the saved take without regenerating`, 2 + i, total);
      await recordTake(s, s.clip!, await assess(await mediaDataUrl(s.clip!), s, i));
      continue;
    }
    const pendingUsd = shots.reduce((sum, _, j) => sum + (j > i && missing.includes(j) ? actual[j]! * perSec : 0), 0);
    let notes = s.clipKey === cacheKeys[i] ? s.clipQa?.notes ?? [] : [];
    let best: { url: string; qa: ShotQA } | undefined;
    for (let attempt = 0; attempt < (provider === "hfmcp" ? 1 : 2); attempt++) {
      if (spent + pendingUsd + actual[i]! * perSec + qCostReserve > plan.budgetUsd) {
        if (best) break;
        throw new Error(`Budget cap reached before shot ${i + 1}. Existing verified assets were kept.`);
      }
      const hCost = quotes.get(i) ?? 0;
      if (hCost > hfLeft) throw new Error("Higgsfield quote exceeds the remaining credits.");
      hfLeft -= hCost;
      s.status = "rendering";
      s.attempts = attempt + 1;
      await step(run, d, `Shot ${i + 1}/${shots.length}: ${attempt ? "repairing the failed take" : "rendering the planned beat"}`, 2 + i, total);
      const prompt = `Required on-screen action: ${s.expectedVisual}. Shot treatment: ${s.visual}. Camera: ${s.camera}. Look: ${CATEGORIES[plan.category].look}.
Start from the attached frame. Preserve the exact product; no invented text or labels. Natural physical motion. ${notes.length ? `Fix these defects: ${notes.join(" ")}` : ""}`;
      const take = await generateVideo(model, prompt, { firstFrame: firsts[i], seconds: actual[i], audio: false, resolution });
      charge(take.usage.costUsd);
      const stored = await storeMedia(take.url, `${run.id}/${d.id}-${s.id}-clip-${randomUUID()}`);
      Object.assign(s, { clip: stored, clipKey: cacheKeys[i], clipModel: model, clipQa: null });
      await saveRun(run);
      const verdict = await assess(take.url, s, i);
      if (!best || shotReady(verdict) || verdict.score > best.qa.score) best = { url: stored, qa: verdict };
      await recordTake(s, best.url, best.qa);
      if (shotReady(verdict) || verdict.match === "review") break;
      notes = [...verdict.notes, ...(verdict.frames ?? []).filter((x) => x.match === "fail").map((x) => `${x.at}s: ${x.note}`)].slice(0, 8);
    }
    if (!best) throw new Error(`No take returned for shot ${i + 1}.`);
  }

  await step(run, d, "Assembling the locked edit", 2 + shots.length, total);
  const clips = await Promise.all(shots.map((s) => mediaDataUrl(s.clip!)));
  const st = await stitchShots(clips, { voices, music, shotSeconds: shots.map((s) => s.seconds), width: tier === "final" ? 1080 : 486 });
  const segments = shots.map((s, i) => ({ shotId: s.id, start: st.starts[i], end: st.starts[i] + s.seconds, text: s.vo, onScreen: s.onScreen }));
  const end = {
    brand: kit?.name && !kit.name.includes(".") ? kit.name : run.research?.brand || brandName(run.brandUrl),
    cta: d.approvedScript!.cta,
    color: kit?.colorRoles?.primary || run.research?.colors?.[0],
    logo: kit?.logo ? await mediaDataUrl(kit.logo).catch(() => null) : null,
    fontFile: kit?.font?.file ? await mediaFile(kit.font.file).catch(() => null) : null,
    fontFamily: kit?.font?.family ?? null,
  };
  await step(run, d, "Reading rendered copy and checking speech and visuals", 3 + shots.length, total);
  const cues = expectedCopy(segments, end, st.duration);
  const inspect = async (files: { aspect: string; url: string }[]) => (await Promise.all(files.map(async (v) => [
    ...await checkExport(v.url, v.aspect, st.duration + END_SECONDS, cues),
    ...await audioFindings(v.url, st.duration, v.aspect),
  ]))).flat();
  let variants = await captionVariants(st.url, "", end, segments, aspects, d.compactCopy);
  let findings = await inspect(variants);
  if (!d.compactCopy && findings.some((f) => f.kind === "copy" || (f.kind === "coverage" && f.aspect))) {
    variants = await captionVariants(st.url, "", end, segments, aspects, true);
    findings = await inspect(variants);
    d.compactCopy = true;
    warnings.push("Re-typeset the export after an on-screen copy mismatch; no shots were regenerated.");
  }
  const main = variants.find((v) => v.aspect === "9:16")!.url;
  const speech = await verifySpeech(main, [...segments, { start: 0, end: st.duration + END_SECONDS, text: shots.map((s) => s.vo).join(" ") }], transcribe);
  charge(speech.cost);
  findings.push(...speech.findings);
  for (const finding of speech.findings) {
    if (finding.kind !== "speech") continue;
    const shot = shots.find((s) => s.id === finding.shotId);
    if (shot?.vo) delete shot.voiceTrack;
  }

  const evidence: VideoQuality["shots"] = [];
  for (const [i, s] of shots.entries()) {
    const segment = segments[i];
    let finalQa: ShotQA | undefined;
    if (shotReady(s.clipQa)) {
      try {
        const frames = await evidenceFrames(main, frameTimes(segment.start, segment.end), segment);
        const v = await reviewShotFrames(run.models.vision, frames, s, refs, firsts[i], "export");
        finalQa = v.qa;
        charge(v.cost);
      } catch {
        finalQa = { score: 0, match: "review", notes: ["Final visual verification could not run."] };
      }
      const failures = finalQa.frames?.filter((f) => f.match === "fail") ?? [];
      if (failures.some((f) => f.repair === "layout")) d.compactCopy = true;
      if (failures.some((f) => f.repair === "source")) {
        s.clipQa = { ...finalQa, notes: [...finalQa.notes, ...(finalQa.frames ?? []).filter((f) => f.match === "fail").map((f) => f.note)] };
        s.status = "failed";
      }
    }
    const result = finalQa ?? s.clipQa;
    if (!shotReady(result)) {
      const mismatch = result?.frames?.find((f) => f.match === "fail");
      const at = mismatch ? (finalQa ? mismatch.at : segment.start + mismatch.at) : segment.start;
      const observed = mismatch?.note || result?.notes.join(" ") || "Missing visual verdict";
      findings.push({ kind: mismatch?.repair === "layout" ? "copy" : "visual", shotId: s.id, at, expected: s.expectedVisual ?? s.visual, observed, status: !result || result.match === "review" ? "review" : "fail" });
    }
    const frameReport = !finalQa && result?.frames ? { ...result, frames: result.frames.map((f) => ({ ...f, at: segment.start + f.at })) } : result;
    evidence.push({ id: s.id, start: segment.start, end: segment.end, visual: s.expectedVisual ?? s.visual, vo: segment.text, onScreen: segment.onScreen ?? "", keyframe: s.keyframe, qa: frameReport });
  }

  let craft: QAResult = { score: 0, pass: false, notes: [] };
  try {
    const review = await qa(run.models.vision, main, "video", run.brief!, d.hook, shots.map((s) => s.onScreen).join(" "));
    craft = review.data;
    charge(review.cost);
  } catch {
    findings.push({ kind: "coverage", at: 0, expected: "Independent review of the finished creative", observed: "Creative Director review could not run", status: "review" });
  }
  if (craft.notes.length && craft.score < QA_PASS) findings.push({ kind: "visual", at: 0, expected: "Finished creative at 9/10", observed: craft.notes.join(" "), status: "fail" });
  const quality = { ...exportVerdict(tier, craft.score, evidence, findings, variants.map((v) => v.aspect)), storyboardKey: d.storyboardKey! };
  const result = { score: quality.score, pass: videoReady(quality), notes: [...findings.slice(0, 5).map((f) => f.observed), ...craft.notes] };
  await saveCreative(run, d, { url: main, type: "video", model, variants, quality }, result, spent, null);
  if (tier === "draft") d.passingDraft = result.pass ? d.storyboardKey : null;
  run.job = null;
  return { quality, spent, warnings };
}

const shortHash = (input: unknown) => createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24);

async function checkedVoice(line: string, voice: string, charge: (n: number) => void) {
  for (let i = 0; i < 2; i++) {
    const v = await voiceover(line, voice);
    charge(v.usage.costUsd);
    const heard = await transcribeLine(v.url, transcribe);
    charge(heard.usage.costUsd);
    if (sameSpeech(heard.text, line)) return v.url;
  }
  throw new Error("The narration did not match an approved line after two attempts. Check pronunciation or reapprove revised wording before video spend.");
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
