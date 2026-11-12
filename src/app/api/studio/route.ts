import { after, NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULTS } from "@/lib/models";
import { brief, directions, diversityScores, filmstrip, organic, qa, render, research, styleDNA } from "@/lib/pipeline";
import { audioConfigured, generateVideo, musicBed, voiceover } from "@/lib/ai";
import { CATEGORIES, keyframe, planShots, QA_PASS, shotQA } from "@/lib/video-plan";
import { captionVariants, mediaDuration, spokenScript, stitchShots } from "@/lib/video-post";
import { get, list, mediaDataUrl, newId, put, storeMedia } from "@/lib/store";
import { currentUser } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import type { Brief, Creative, Direction, QAResult, RunEvent, Shot, StudioRun } from "@/lib/types";

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
  z.object({ action: z.literal("cancel"), runId: z.string().max(64) }),
  z.object({ action: z.literal("storyboard"), runId: z.string().max(64), directionId: z.string().max(32).optional(), plan: Plan, refs: Refs }),
  z.object({ action: z.literal("redo_shot"), runId: z.string().max(64), directionId: z.string().max(32), shotId: z.string().max(8), visual: z.string().trim().min(5).max(800).optional(), refs: Refs }),
  z.object({ action: z.literal("render_video"), runId: z.string().max(64), directionId: z.string().max(32), tier: z.enum(["draft", "final"]), refs: Refs }),
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
  Object.assign(run, { status: "error", activity: null, jobId: null, updatedAt: now() });
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
    run = await healOrphan(found);
  }
  if (body.action === "cancel") {
    if (run.status !== "working") return NextResponse.json({ error: "Nothing is running" }, { status: 400 });
    if (run.jobId) {
      jobs.get(run.jobId)?.abort();
      jobs.delete(run.jobId);
    }
    stopProgress(run);
    Object.assign(run, { status: "idle", activity: null, jobId: null, updatedAt: now() });
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
      if (jobs.delete(jobId)) {
        Object.assign(run, { activity: null, jobId: null, updatedAt: now() });
        await put("studio_runs", run);
      }
    }
  });
  return NextResponse.json({ run });
}

const brandName = (url: string) => {
  const host = new URL(url).hostname.replace(/^www\./, "").split(".")[0];
  return host.charAt(0).toUpperCase() + host.slice(1);
};

type Parsed = z.infer<typeof Body>;

function plan(run: StudioRun, body: Exclude<Parsed, { action: "edit_brief" | "cancel" }>): { activity: string; work: () => Promise<void> } | { error: string } {
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
    case "storyboard": {
      if (!run.brief || !run.research || !run.directions.length) return { error: "Pitch directions first" };
      const p = body.plan;
      run.videoPlan = {
        category: p.category,
        lengthSec: p.lengthSec,
        draftModel: p.draftModel ?? "bytedance/seedance-2.0-fast",
        finalModel: p.finalModel ?? run.models.video,
        voice: p.voice ?? "Rachel",
        music: p.music ?? true,
        budgetUsd: p.budgetUsd ?? 10,
      };
      const targets = body.directionId ? run.directions.filter((d) => d.id === body.directionId) : run.directions;
      if (!targets.length) return { error: "Direction not found" };
      return {
        activity: `Storyboarding ${targets.length === 1 ? `“${targets[0].title}”` : `${targets.length} directions`}: shot list, keyframes and keyframe QA…`,
        work: async () => {
          const res = await Promise.allSettled(targets.map((d) => storyboard(run, d, body.refs ?? [])));
          res.forEach((r, k) => {
            if (r.status === "rejected") {
              run.progress[targets[k].id] = "failed";
              say(run, "error", `Storyboard for “${targets[k].title}” failed: ${String(r.reason?.message ?? r.reason).slice(0, 300)}`);
            }
          });
          say(run, "agent", "Storyboards are ready. Check the keyframes, redo or edit any shot, then render a draft video for the directions you like.");
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
      return {
        activity: `Rendering the ${body.tier} video for “${d.title}”: ${d.shots.length} shots, shot QA, voice, music and final QA…`,
        work: async () => {
          const r = await renderVideo(run, d, body.tier, body.refs ?? []);
          run.stage = "qa";
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

const goalCtx = (run: StudioRun) =>
  run.offer ? `${run.goal}\nReal offer terms (use exactly; never invent prices, discounts or shipping terms beyond these): ${run.offer}` : run.goal;

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
) {
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
    qa: q,
    qaOverride: null,
    diversity,
    status: "draft",
    channel: null,
    metrics: null,
    costUsd: spent,
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

const KEYFRAME_TRIES = 2;
const CLIP_TRIES = 2;

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
  Object.assign(s, { keyframe: await storeMedia(best!.url, `${run.id}/${d.id}-${s.id}-kf-${Date.now()}`), keyframeQa: best!.qa, clip: null, clipQa: null, status: "keyframe" });
  await saveRun(run);
}

async function storyboard(run: StudioRun, d: Direction, refs: string[]) {
  run.progress[d.id] = "rendering";
  await saveRun(run);
  const p = await planShots(run.models.text, d, run.brief!, run.research!, run.videoPlan!, run.styleDNA);
  d.shots = p.shots;
  run.costUsd += p.cost;
  await saveRun(run);
  await Promise.all(d.shots.map((s) => makeKeyframe(run, d, s, refs)));
  run.progress[d.id] = "done";
  await saveRun(run);
}

async function renderVideo(run: StudioRun, d: Direction, tier: "draft" | "final", refs: string[]) {
  const plan = run.videoPlan!;
  const model = tier === "final" ? plan.finalModel : plan.draftModel;
  const shots = d.shots!;
  const withAudio = audioConfigured();
  let spent = 0;
  run.progress[d.id] = "rendering";
  await saveRun(run);
  await Promise.all(
    shots.map(async (s) => {
      s.status = "rendering";
      s.attempts = 0;
      const first = await mediaDataUrl(s.keyframe!);
      let notes: string[] = [];
      let best: { url: string; qa: { score: number; notes: string[] } } | null = null;
      while (s.attempts < CLIP_TRIES) {
        s.attempts++;
        const prompt = `${s.visual}
Camera: ${s.camera}. Look: ${CATEGORIES[plan.category].look}.
Start exactly from the given first frame and keep the product, people and setting consistent. Natural, physically plausible motion, no morphing. No text, captions, logos or price tags appear.${!withAudio && s.vo ? `\nSpoken line: "${s.vo}"` : ""}${notes.length ? `\nFix from the last take: ${notes.join(" ")}` : ""}`;
        const v = await generateVideo(model, prompt, { firstFrame: first, seconds: s.seconds, audio: !withAudio, resolution: tier === "final" ? "1080p" : "480p" });
        const sheet = await filmstrip(v.url);
        const q = await shotQA(run.models.vision, sheet.sheet, s, "clip", refs[0]);
        spent += v.usage.costUsd + q.cost;
        if (!best || q.qa.score > best.qa.score) best = { url: v.url, qa: q.qa };
        if (q.qa.score >= QA_PASS || spent >= plan.budgetUsd) break;
        notes = q.qa.notes;
        run.progress[d.id] = "fixing";
        await saveRun(run);
      }
      Object.assign(s, { clip: await storeMedia(best!.url, `${run.id}/${d.id}-${s.id}-clip-${Date.now()}`), clipQa: best!.qa, status: "done" });
      await saveRun(run);
    }),
  );
  run.progress[d.id] = "qa";
  await saveRun(run);
  const clips = await Promise.all(shots.map((s) => mediaDataUrl(s.clip!)));
  const total = shots.reduce((t, s) => t + s.seconds, 0);
  let voices: { url: string; start: number; tempo?: number }[] = [];
  let music: string | null = null;
  if (withAudio) {
    const starts = shots.map((_, i) => shots.slice(0, i).reduce((t, s) => t + s.seconds, 0));
    const [vo, mu] = await Promise.all([
      Promise.all(shots.map((s) => (spokenScript(s.vo) ? voiceover(spokenScript(s.vo), plan.voice) : null))).catch((e) => {
        say(run, "error", `Voiceover failed, using the video model's audio: ${(e as Error).message}`);
        return null;
      }),
      plan.music
        ? musicBed(`Instrumental bed for a ${CATEGORIES[plan.category].label.toLowerCase()} video ad. Mood: ${run.research?.tone ?? "modern, upbeat"}. Clean, modern, builds to a lift near the end, no vocals.`, total + 2).catch((e) => {
            say(run, "error", `Music failed: ${(e as Error).message}`);
            return null;
          })
        : null,
    ]);
    if (vo) {
      voices = await Promise.all(
        vo.flatMap((v, i) => (v ? [{ v, i }] : [])).map(async ({ v, i }) => {
          spent += v.usage.costUsd;
          const len = await mediaDuration(v.url);
          return { url: v.url, start: starts[i] + 0.15, tempo: len > shots[i].seconds - 0.3 ? len / (shots[i].seconds - 0.3) : undefined };
        }),
      );
    }
    if (mu) {
      spent += mu.usage.costUsd;
      music = mu.url;
    }
  }
  const st = await stitchShots(clips, { voices, music });
  const segments = shots.map((s, i) => ({ start: st.starts[i], end: st.starts[i + 1] ?? st.duration, text: s.vo }));
  const end = { brand: brandName(run.brandUrl), line: d.copy?.metaHeadline, cta: d.copy?.metaCta, color: run.research?.colors?.[0] };
  const variants = await captionVariants(st.url, "", end, segments).catch((e) => {
    console.error("caption/variants failed", (e as Error).message);
    return [];
  });
  const main = variants.find((x) => x.aspect === "9:16")?.url ?? st.url;
  const q = await qa(run.models.vision, main, "video", run.brief!, d.hook);
  spent += q.cost;
  await saveCreative(run, d, { url: main, type: "video", model, variants }, q.data, spent, null);
  return { score: q.data.score, spent };
}

async function generateMany(run: StudioRun, dirs: Direction[], refs: string[]) {
  const m = run.models;
  const div = diversityScores(run.directions.map((d) => `${d.angle} ${d.visualPrompt}`));
  const save = async () => {
    if (!live(run)) throw new Error("Stopped");
    await put("studio_runs", { ...run, updatedAt: now() });
  };
  const results = await Promise.allSettled(
    dirs.map(async (d) => {
      const i = run.directions.indexOf(d);
      const opts = { imageModel: m.image, videoModel: m.video, refs, seed: i, brand: brandName(run.brandUrl), style: { styleRef: run.research?.styleRef, colors: run.research?.colors } };
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
