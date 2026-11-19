import { randomUUID } from "node:crypto";
import { jobSteps } from "@/lib/job-progress";
import { providerOf } from "@/lib/models";
import { qa } from "@/lib/pipeline";
import { aiConfigured, audioConfigured, transcribe, generateVideo, musicBed, MUSIC_COST, MUSIC_MODEL, VOICE_MODEL, openrouterCredits, videoDurations, videoPricePerSec, voiceover } from "@/lib/ai";
import { lookLine, musicPrompt } from "@/lib/video-looks";
import { upscaleClip } from "@/lib/upscale";
import { blenderAvailable, buildWorld, cameraPlate, REAL_SET_RESERVE, realSetStatus } from "@/lib/real-set";
import { lipSync, loudness, sceneCuts, werCheck, wordTimings } from "@/lib/qa-tools";
import { CATEGORIES, keyframe, locateSubjects, medianReview, planShots, QA_PASS, reviewShotFrames } from "@/lib/video-plan";
import { checkScript, nearSpeech } from "@/lib/script-lab";
import { canonExpected, canonHeard } from "@/lib/speech-canon";
import { approvedStoryboardLength, scriptProductionBlockers, shotReady, storyboardKeyframeFixes, videoAspects, videoReady } from "@/lib/quality-policy";
import { captionMode } from "@/lib/caption-agent";
import { captionVariants, END_SECONDS, expectedCopy, meanVolume, mediaDuration, placedCues, stitchShots } from "@/lib/video-post";
import { type CopyCue, asrVocabulary, audioFindings, checkExport, evidenceFrames, exportVerdict, frameTimes, localOcrAvailable, reusableShot, transcribeLine, verifySpeech, videoTechnicalFindings } from "@/lib/media-qa";
import { list, mediaDataUrl, mediaFile, newId, put, storeMedia } from "@/lib/store";
import type { Direction, JobPhase, QAResult, QualityFinding, Shot, ShotQA, StudioRun, VideoQuality, VideoTake } from "@/lib/types";
import { now, say, live, saveRun } from "./run-state";
import { brandFor, guidance, brandName, shortHash, swipesFor } from "./context";
import { inspirationGuidance } from "@/lib/inspiration";
import { labelled, negativePrompt, specBlock } from "@/lib/shot-spec";
import { candidateCount, draftEstimate, pickCandidate } from "@/lib/best-of-n";
import { captionSync, captionSyncFindings } from "@/lib/caption-sync";
import { endCardItems } from "@/lib/brief-policy";
import { onBeatShare } from "@/lib/beat-sync";
import { sfxCues } from "@/lib/sfx";
import { PACKSHOT_MODEL, packshotAvailable, packshotShot, renderPackshot } from "@/lib/packshot";
import { saveCreative } from "./creatives";
import { better, gateJudge, shotsGate, audioChecks, editChecks, finalChecks, judgeContinuity, videoChecks, voiceChecks, type VoiceLine } from "@/lib/stage-gates";
import { saveStage, stageBlock, stageScore } from "@/lib/stage-policy";
import { latestCalibration } from "@/lib/judge-calibration";

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

/** True-colour packshot still per run (free Blender render), cached so every labelled shot reuses one. */
const trueColour = new Map<string, Promise<string | null>>();
/**
 * Labelled hero shots draw their keyframe from the true-colour packshot still first, then the real photo (13.34):
 * the image model copies a flat, front-on, colour-managed label far better than a photo with glare and perspective.
 */
export async function keyframeRefs(run: StudioRun, s: Shot, refs: string[]): Promise<string[]> {
  if (!labelled(s) || !refs[0] || !run.videoPlan?.packshot || !(await packshotAvailable())) return refs;
  if (!trueColour.has(run.id)) trueColour.set(run.id, renderPackshot(refs[0], { width: 486, height: 864, still: true }).catch(() => null));
  const still = await trueColour.get(run.id);
  return still ? [still, refs[0]] : refs;
}

export async function makeKeyframe(run: StudioRun, d: Direction, s: Shot, refs: string[]): Promise<ShotQA> {
  const plan = run.videoPlan!;
  let best: { url: string; qa: ShotQA } | null = null;
  let notes: string[] | undefined;
  for (let a = 0; a < KEYFRAME_TRIES; a++) {
    if (!live(run)) throw new Error("Stopped before generating a keyframe.");
    const plate = d.realSet?.plates[s.id] ? await mediaDataUrl(d.realSet.plates[s.id]) : null;
    const img = s.source === "packshot" && refs[0]
      ? { url: await renderPackshot(refs[0], { width: 486, height: 864, still: true }), usage: { costUsd: 0 } }
      : await keyframe(run.models.image, s, plan.category, await keyframeRefs(run, s, refs), run.research?.colors, notes, lookLine(plan, s), plate);
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

export async function storyboard(run: StudioRun, d: Direction, refs: string[], savedRefs: string[]) {
  const structure = inspirationGuidance((await swipesFor(run)).flatMap((x) => x.breakdown ? [x.breakdown] : []));
  const rules = (await guidance(run)) + structure;
  const winners = await winningShots(run);
  let p = await planShots(run.models.text, d, run.brief!, run.research!, run.videoPlan!, run.styleDNA, winners, rules);
  // Shot-plan gate before any keyframe spend: specific, consistent cast and set, lens and continuity, matching the script.
  if (aiConfigured()) {
    const cal = await latestCalibration();
    const judge = gateJudge(run);
    let gate = await shotsGate(judge, p.shots, cal);
    if (!gate.score.pass) {
      const again = await planShots(run.models.text, d, run.brief!, run.research!, run.videoPlan!, run.styleDNA, winners, `${rules}\nA director rejected the last shot list (${gate.score.score}/10). Fix every point: ${gate.fixes.join(" | ")}`).catch(() => null);
      if (again) {
        run.costUsd += again.cost;
        const g2 = await shotsGate(judge, again.shots, cal, 2);
        if (g2.score.score >= gate.score.score) p = { ...again, cost: p.cost };
        gate = better(gate, g2);
      }
    }
    run.costUsd += gate.cost;
    saveStage(run, gate.score, d.id);
    if (!gate.score.pass) say(run, "error", `${stageBlock(run, "shots", d.id)} Top fixes: ${gate.fixes.slice(0, 3).join(" ")}`);
  }
  // Hero end shot: the last beat becomes a Blender packshot of the real label (free, never a re-drawn can).
  if (run.videoPlan!.packshot && refs.length && p.shots.length > 1 && await packshotAvailable()) {
    const product = run.research?.brand || "product";
    p = { ...p, shots: [...p.shots.slice(0, -1), packshotShot(p.shots.at(-1)!, product)] };
  }
  Object.assign(d, { shots: p.shots, productRefs: savedRefs, storyboardKey: randomUUID(), passingDraft: null, compactCopy: false });
  run.costUsd += p.cost;
  if (run.job) {
    run.job.total += p.shots.length;
    run.job.label = "Drawing keyframes and running keyframe QA";
  }
  await saveRun(run);
  d.realSet = null;
  if (!run.videoPlan!.realSet) {
    await Promise.all(p.shots.map((s) => makeKeyframe(run, d, s, refs)));
    return;
  }
  // Real set: draw the hero frame, grow one 3D world from it, then shoot every other keyframe inside that world.
  const [hero, ...rest] = p.shots;
  await makeKeyframe(run, d, hero, refs);
  const set = await buildRealSet(run, d, hero).catch((e: Error) => {
    say(run, "error", `Real set skipped: ${e.message} Keyframes were drawn without it.`);
    return null;
  });
  if (set) d.realSet = set;
  await Promise.all(rest.map((s) => makeKeyframe(run, d, s, refs)));
}

async function buildRealSet(run: StudioRun, d: Direction, hero: Shot) {
  const status = realSetStatus();
  if (!status.available) throw new Error(status.reason!);
  if (!await blenderAvailable()) throw new Error("Blender isn't installed (BLENDER_BIN), so camera plates can't be rendered.");
  const plan = run.videoPlan!;
  const key = shortHash([d.storyboardKey, hero.keyframe]);
  const world = await buildWorld(await mediaDataUrl(hero.keyframe!), `${hero.visual} ${lookLine(plan, hero)}`, { live: () => live(run) });
  run.costUsd += REAL_SET_RESERVE;
  const pano = await storeMedia(world.pano, `${run.id}/${d.id}-set-${key}`);
  const plates: Record<string, string> = {};
  for (const [i, s] of d.shots!.entries()) {
    if (i === 0) continue;
    plates[s.id] = await storeMedia(await cameraPlate(world.pano, s, i, plan.lens), `${run.id}/${d.id}-plate-${s.id}-${key}`);
  }
  say(run, "agent", `Built a real set (World Labs world ${world.worldId}) and rendered ${Object.keys(plates).length} camera plates in Blender. Every keyframe is shot in the same set.`);
  return { key, provider: "worldlabs" as const, worldId: world.worldId, pano, plates, costUsd: REAL_SET_RESERVE };
}

const SILENT_DB = -50;

/**
 * Persists job progress for the UI: overall step, phase, and per-shot stages (queued → rendering → qa → done).
 * `shot` moves one shot to a new stage; shots keep their stage between steps.
 */
async function step(run: StudioRun, d: Direction, label: string, done: number, total: number, phase?: JobPhase, shot?: { i: number; stage: JobPhase }) {
  if (!live(run)) throw new Error("Stopped before the next production step.");
  const prev = run.job?.directionId === d.id && phase !== "preflight" ? run.job : null;
  const shots = prev?.shots ?? d.shots!.map((s) => ({ id: s.id, stage: "queued" as JobPhase }));
  if (shot) markShot(shots, shot.i, shot.stage);
  run.job = { directionId: d.id, label, done, total, phase: phase ?? prev?.phase ?? "preflight", startedAt: prev?.startedAt ?? (phase === "preflight" && run.job?.directionId === d.id ? run.job.startedAt : undefined) ?? now(), shots };
  await saveRun(run);
}

function markShot(shots: NonNullable<NonNullable<StudioRun["job"]>["shots"]>, i: number, stage: JobPhase) {
  const s = shots[i];
  if (!s) return;
  const t = now();
  shots[i] = { ...s, stage, startedAt: s.startedAt ?? (stage === "queued" ? undefined : t), endedAt: stage === "done" || stage === "failed" ? t : undefined };
}

const shotDone = (run: StudioRun, i: number, ok: boolean) => {
  if (run.job?.shots) markShot(run.job.shots, i, ok ? "done" : "failed");
};

const ROUTER_UNREACHABLE = "Could not reach OpenRouter to check the balance (network or a busy machine). Nothing was spent; press Retry.";

/** The model a shot renders with: the operator's per-shot pick, else the plan's draft model. */
const shotModel = (s: Shot, fallback: string) => s.model || fallback;

type Voice = { url: string; start: number; tempo?: number };

/**
 * One cheap 480p preview take. Preflight (keyframes, budget, credits, voice + music made and checked) runs before
 * any paid video; then shots render one at a time under the budget cap, are QA'd, stitched, mixed and QA'd again.
 * Shots that already passed are reused, so later takes only re-shoot what failed.
 */
export async function renderVideo(run: StudioRun, d: Direction, tier: "draft" | "final", cap = run.videoPlan!.budgetUsd, opts: { acceptWarnings?: boolean } = {}) {
  if (tier === "final") return upscaleTake(run, d, cap, opts.acceptWarnings);
  const plan = run.videoPlan!;
  const shots = d.shots!;
  const resolution = "480p";
  const total = jobSteps("draft", shots.length).total;
  const warnings: string[] = [];
  let spent = 0;
  const charge = (cost: number) => { spent += cost; run.costUsd += cost; };

  await step(run, d, "Preflight: script, references, QA tools and budget", 0, total, "preflight");
  const kit = await brandFor(run);
  const issues = [...new Set([
    ...scriptProductionBlockers(d.approvedScript),
    ...checkScript(d.approvedScript!, approvedStoryboardLength(d)!, kit?.mustSay),
  ])];
  const weak = storyboardKeyframeFixes(shots);
  const testDraft = issues.length > 0 || weak.length > 0;
  if (!audioConfigured()) throw new Error("Connect fal.ai for separate, verified voiceover before rendering.");
  if (!await localOcrAvailable()) throw new Error("Video QA requires local Tesseract and its configured language. No video was requested.");
  const refs = await Promise.all((d.productRefs ?? []).slice(0, 2).map(mediaDataUrl));
  if (!refs.length) throw new Error("Rebuild the storyboard with real product references.");
  const models = shots.map((s) => shotModel(s, plan.draftModel));
  const durationsOf = new Map<string, number[] | undefined>();
  const priceOf = new Map<string, number>();
  for (const m of new Set(models)) {
    if (m === PACKSHOT_MODEL) {
      priceOf.set(m, 0);
      continue;
    }
    durationsOf.set(m, (await videoDurations(m))?.filter((n) => n > 0).sort((a, b) => a - b));
    priceOf.set(m, providerOf(m) === "hfmcp" ? 0 : (await videoPricePerSec(m, resolution, false)) ?? 0.12);
  }
  const seconds = shots.reduce((t, s) => t + s.seconds, 0);
  const actual = shots.map((s, i) => { const durs = durationsOf.get(models[i]); return durs?.length ? durs.find((n) => n >= s.seconds) : s.seconds; });
  if (actual.some((s) => s === undefined)) throw new Error("The chosen model cannot cover a locked beat. Pick a model with longer takes.");
  const cacheKeys = shots.map((s, i) => shortHash(["video-qa-v2", resolution, models[i], plan.category, d.productRefs, s.keyframe, s.expectedVisual, s.visual, s.camera, s.seconds, lookLine(plan, s), ...(s.spec ? [s.spec] : [])]));
  const toReview = (s: Shot, i: number) => s.clipKey === cacheKeys[i] && !!s.clip && (!s.clipQa || s.clipQa.match === "review");
  const missing = shots.flatMap((s, i) => reusableShot(s, cacheKeys[i]) || toReview(s, i) ? [] : [i]);
  const perSec = (i: number) => priceOf.get(models[i]) ?? 0.12;
  const musicKey = shortHash([MUSIC_MODEL, plan.category, seconds, run.research?.tone, plan.musicStyle ?? "auto"]);
  const reserve = 0.12 + shots.length * 0.035 + (plan.music && d.musicTrack?.key !== musicKey ? MUSIC_COST : 0);
  // Best-of-N: N 480p candidates per missing shot (one for Higgsfield credits and for test drafts).
  const nFor = (i: number) => (testDraft || models[i] === PACKSHOT_MODEL || providerOf(models[i]) === "hfmcp" ? 1 : candidateCount(plan.candidates));
  const est = draftEstimate(missing.map((i) => ({ seconds: actual[i]!, perSec: perSec(i) * nFor(i) / Math.max(1, candidateCount(plan.candidates)) })), candidateCount(plan.candidates), reserve);
  const estimated = est.total;
  if (estimated > cap) throw new Error(`Preflight: estimated $${estimated.toFixed(2)} (${missing.length} shots × ${candidateCount(plan.candidates)} candidates) exceeds the $${cap.toFixed(2)} cap. No video was requested. Lower candidates per shot or raise the cap.`);
  const renders = missing.reduce((t, i) => t + nFor(i), 0);
  if (missing.length) say(run, "agent", `Cost estimate before any video spend: ${missing.length} shot${missing.length === 1 ? "" : "s"}, ${renders} render${renders === 1 ? "" : "s"} (up to ${candidateCount(plan.candidates)} candidates per paid shot) ≈ $${est.motion.toFixed(2)} motion + $${est.qa.toFixed(2)} QA + $${est.reserve.toFixed(2)} voice/music/final QA = $${estimated.toFixed(2)} (cap $${cap.toFixed(2)}).`);
  const router = await openrouterCredits();
  const routerSpend = missing.reduce((sum, i) => sum + (providerOf(models[i]) === "openrouter" ? actual[i]! * perSec(i) * nFor(i) : 0), 0);
  if (router == null) throw new Error(ROUTER_UNREACHABLE);
  if (router < Math.max(0.05, routerSpend * 1.1)) {
    throw new Error(`OpenRouter has $${router.toFixed(2)} left, too low for the required review. Check Credits and Guardrails.`);
  }

  let hfLeft = 0;
  const quotes = new Map<number, number>();
  const hfShots = missing.filter((i) => providerOf(models[i]) === "hfmcp");
  if (hfShots.length) {
    const { higgsfieldCredits, higgsfieldVideoCost } = await import("@/lib/higgsfield-mcp");
    const [left, costs] = await Promise.all([higgsfieldCredits(), Promise.all(hfShots.map((i) => higgsfieldVideoCost(models[i].replace(/^hfmcp:/, ""), { seconds: actual[i], resolution })))]);
    if (left == null || costs.some((c) => c == null || !Number.isFinite(c) || c <= 0)) throw new Error("Higgsfield did not confirm the balance and per-shot quote. No video was requested.");
    hfLeft = left;
    hfShots.forEach((i, j) => quotes.set(i, costs[j]!));
    const need = costs.reduce<number>((a, b) => a + b!, 0);
    if (hfLeft < need) throw new Error(`Higgsfield needs ${need.toFixed(1)} credits for the remaining shots; ${hfLeft.toFixed(1)} are available.`);
    say(run, "agent", `Higgsfield quote: ${need.toFixed(1)} credits for ${hfShots.length} remaining shots. Subscription retries are off; use Repair to authorize another take.`);
  }

  await step(run, d, "Making and verifying voice and music before motion spend", 1, total, "voice");
  let start = 0;
  const voices: Voice[] = [];
  const voiceLines: VoiceLine[] = [];
  for (const [i, s] of shots.entries()) {
    if (!live(run)) throw new Error("Stopped before the next voiceover.");
    const line = s.vo.trim();
    if (line) {
      const key = shortHash([VOICE_MODEL, line, plan.voice, s.seconds]);
      let tries = 1, lineDb: number | null = null;
      if (s.voiceTrack?.key !== key) {
        const voice = await checkedVoice(line, plan.voice, charge, (n) => { tries = n; }, run.research?.brand, run.research?.pronunciation);
        const [len, db] = await Promise.all([mediaDuration(voice), meanVolume(voice)]);
        lineDb = db;
        const room = s.seconds - 0.3;
        if (len < 0.3 || db < SILENT_DB || len > room * 1.3) throw new Error(`Voice for shot ${i + 1} is silent or too long for the approved beat. Shorten the script and review it again; no video was requested.`);
        s.voiceTrack = { key, url: await storeMedia(voice, `${run.id}/${d.id}-voice-${i}-${key}`), tempo: len > room ? len / room : undefined };
        await saveRun(run);
      }
      voices.push({ url: s.voiceTrack.url, start: start + 0.15, tempo: s.voiceTrack.tempo });
      voiceLines.push({ heard: true, tries, tempo: s.voiceTrack.tempo, meanDb: lineDb });
    }
    start += s.seconds;
  }
  // Judge the voice lines before buying music ($0.60/min): a line that has to be sped up fails here for free (13.22).
  const voicePre = stageScore("voice", voiceChecks(voiceLines, { planned: !!plan.music, ok: true }), "rules", 1,
    voiceChecks(voiceLines, { planned: !!plan.music, ok: true }).filter((c) => c.score < 8).map((c) => `${c.name}: ${c.note}`));
  saveStage(run, voicePre, d.id);
  const voicePreBlock = stageBlock(run, "voice", d.id);
  if (voicePreBlock) throw new Error(`${voicePreBlock} ${voicePre.notes.join(" ")} No music or video was bought.`);

  let music: string | null = null;
  if (plan.music) {
    if (!live(run)) throw new Error("Stopped before music production.");
    try {
      if (d.musicTrack?.key !== musicKey) {
        const mu = await musicBed(musicPrompt(plan, CATEGORIES[plan.category].label, run.research?.tone), seconds + 2);
        charge(mu.usage.costUsd);
        if (await meanVolume(mu.url) < SILENT_DB) throw new Error("silent music bed");
        d.musicTrack = { key: musicKey, url: await storeMedia(mu.url, `${run.id}/${d.id}-music-${musicKey}`) };
        await saveRun(run);
      }
      music = d.musicTrack.url;
    } catch {
      throw new Error("The selected music bed is unavailable or silent. No video was requested. Retry or disable music in the video plan.");
    }
  }

  // Voice & music gate, before any motion spend: every line heard back, fits its beat at natural speed, music audible.
  const voiceGate = stageScore("voice", voiceChecks(voiceLines, { planned: !!plan.music, ok: !!music }), "rules", 1,
    voiceChecks(voiceLines, { planned: !!plan.music, ok: !!music }).filter((c) => c.score < 8).map((c) => `${c.name}: ${c.note}`));
  saveStage(run, voiceGate, d.id);
  const voiceBlock = stageBlock(run, "voice", d.id);
  if (voiceBlock) throw new Error(`${voiceBlock} ${voiceGate.notes.join(" ")} No video was requested.`);

  const firsts = await Promise.all(shots.map((s) => mediaDataUrl(s.keyframe!)));
  const assess = async (video: string, s: Shot, i: number): Promise<ShotQA> => {
    try {
      const technical = await videoTechnicalFindings(video, s.seconds, undefined, plan.category !== "motion_graphics");
      const cuts = await sceneCuts(video).catch(() => null);
      const inner = cuts?.cuts.filter((t) => t > 0.2 && t < s.seconds - 0.2) ?? [];
      if (inner.length) technical.push({ kind: "technical", at: inner[0], expected: "One continuous shot", observed: `Unplanned hard cut inside the clip at ${inner[0].toFixed(2)}s (${cuts!.via})`, status: "fail" });
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
  const recordTake = async (s: Shot, url: string, verdict: ShotQA, model: string) => {
    Object.assign(s, { clip: url, clipQa: verdict, clipModel: model, status: shotReady(verdict) ? "done" : "failed" });
    await saveRun(run);
    await remember(run, s, "clip", model, verdict);
  };
  const qCostReserve = 0.08 + shots.length * 0.025;
  const attempts = testDraft || (plan.takes ?? 1) > 1 ? 1 : 2;
  for (const [i, s] of shots.entries()) {
    if (reusableShot(s, cacheKeys[i])) {
      shotDone(run, i, true);
      continue;
    }
    if (toReview(s, i)) {
      await step(run, d, `Shot ${i + 1}/${shots.length}: verifying the saved take without regenerating`, 2 + i, total, "qa", { i, stage: "qa" });
      await recordTake(s, s.clip!, await assess(await mediaDataUrl(s.clip!), s, i), s.clipModel ?? models[i]);
      shotDone(run, i, true);
      continue;
    }
    const pendingUsd = shots.reduce((sum, _, j) => sum + (j > i && missing.includes(j) ? actual[j]! * perSec(j) * nFor(j) : 0), 0);
    let notes = s.clipKey === cacheKeys[i] ? s.clipQa?.notes ?? [] : [];
    let best: { url: string; qa: ShotQA } | undefined;
    const hf = providerOf(models[i]) === "hfmcp";
    for (let attempt = 0; attempt < (hf ? 1 : attempts); attempt++) {
      if (spent + pendingUsd + actual[i]! * perSec(i) + qCostReserve > cap) {
        if (best) break;
        throw new Error(`Budget cap reached before shot ${i + 1}. Existing verified assets were kept.`);
      }
      const hCost = quotes.get(i) ?? 0;
      if (hCost > hfLeft) throw new Error("Higgsfield quote exceeds the remaining credits.");
      hfLeft -= hCost;
      s.status = "rendering";
      s.attempts = (s.attempts ?? 0) + 1;
      await step(run, d, `Shot ${i + 1}/${shots.length}: ${attempt || notes.length ? "repairing the failed take" : "rendering the planned beat"}`, 2 + i, total, "rendering", { i, stage: "rendering" });
      const look = lookLine(plan, s);
      const prompt = `Required on-screen action: ${s.expectedVisual}. Shot treatment: ${s.visual}. Camera: ${s.camera}. Look: ${CATEGORIES[plan.category].look}.${look ? ` ${look}` : ""}
${specBlock(s)}
Start from the attached frame. Preserve the exact product and its real label; no invented text. Natural physical motion, one continuous shot. Avoid: ${negativePrompt(s)}. ${notes.length ? `Fix these defects: ${notes.join(" ")}` : ""}`;
      // First pass renders N candidates in parallel when they fit the cap; repairs render one.
      const n = attempt === 0 ? Math.max(1, Math.min(nFor(i), Math.floor((cap - spent - pendingUsd - qCostReserve) / (actual[i]! * perSec(i) + 0.02)))) : 1;
      const cands = await Promise.all(Array.from({ length: n }, async () => {
        try {
          const take = models[i] === PACKSHOT_MODEL
            ? { url: await renderPackshot(refs[0], { seconds: actual[i]! + 0.2, width: 486, height: 864 }), usage: { costUsd: 0 } }
            : await generateVideo(models[i], prompt, { firstFrame: firsts[i], seconds: actual[i], audio: false, resolution });
          charge(take.usage.costUsd);
          const stored = await storeMedia(take.url, `${run.id}/${d.id}-${s.id}-clip-${randomUUID()}`);
          return { take, stored };
        } catch (e) {
          if (n === 1) throw e;
          return null;
        }
      }));
      const ok = cands.filter((c): c is NonNullable<typeof c> => !!c);
      if (!ok.length) throw new Error(`No candidate returned for shot ${i + 1}.`);
      Object.assign(s, { clip: ok[0].stored, clipKey: cacheKeys[i], clipModel: models[i], clipQa: null });
      await saveRun(run);
      await step(run, d, `Shot ${i + 1}/${shots.length}: frame-by-frame QA on ${ok.length} candidate${ok.length === 1 ? "" : "s"}`, 2 + i, total, "rendering", { i, stage: "qa" });
      const qas = await Promise.all(ok.map(async (c) => assess(c.take.url.startsWith("data:") ? c.take.url : await mediaDataUrl(c.stored), s, i)));
      const w = pickCandidate(qas);
      const verdict: ShotQA = ok.length > 1 ? { ...qas[w], notes: [...qas[w].notes, `Best of ${ok.length} candidates (scores ${qas.map((q) => q.score).join(", ")}).`] } : qas[w];
      const take = ok[w].take, stored = ok[w].stored;
      void take;
      if (!best || shotReady(verdict) || verdict.score > best.qa.score) best = { url: stored, qa: verdict };
      await recordTake(s, best.url, best.qa, models[i]);
      if (shotReady(verdict) || verdict.match === "review") break;
      notes = [...verdict.notes, ...(verdict.frames ?? []).filter((x) => x.match === "fail").map((x) => `${x.at}s: ${x.note}`)].slice(0, 8);
    }
    if (!best) throw new Error(`No take returned for shot ${i + 1}.`);
    shotDone(run, i, true);
  }

  const clips = shots.map((s, i) => ({ shotId: s.id, url: s.clip!, model: s.clipModel ?? models[i], qa: s.clipQa ?? null }));
  const done = await assembleAndReview(run, d, { tier: "draft", clips, voices, music, spent, charge, warnings, issues: testDraft ? issues : [], weak: testDraft ? weak : [], refs, firsts });
  d.passingDraft = done.pass ? d.storyboardKey : null;
  const take: VideoTake = {
    id: newId("take"), storyboardKey: d.storyboardKey!, creativeId: done.creativeId ?? "", url: done.url, score: done.quality.score, pass: done.pass,
    clips: clips.map(({ shotId, url, model }) => ({ shotId, url, model })), voices, music, costUsd: spent, createdAt: now(), stages: done.stages,
  };
  d.takes = [...(d.takes ?? []).filter((t) => t.storyboardKey === d.storyboardKey), take].slice(-6);
  await saveRun(run);
  return { quality: done.quality, spent, warnings, take };
}

/**
 * HD from the approved 480p take: the same clips are upscaled locally (Real-ESRGAN, free) and re-cut with the same
 * narration and music, so nothing the operator approved changes. Only QA calls cost money here.
 */
async function upscaleTake(run: StudioRun, d: Direction, cap: number, acceptWarnings = false) {
  const shots = d.shots!;
  const take = d.takes?.find((t) => t.id === d.approvedTakeId);
  if (!take) throw new Error("Approve a 480p take before upscaling.");
  if (take.storyboardKey !== d.storyboardKey) throw new Error("The storyboard changed after the approved take. Render and approve a new take.");
  const warnings: string[] = [];
  let spent = 0;
  const charge = (cost: number) => { spent += cost; run.costUsd += cost; };
  const total = jobSteps("final", shots.length).total;
  await step(run, d, "Preflight: approved take, QA tools and budget", 0, total, "preflight");
  const kit = await brandFor(run);
  const issues = [...new Set([...scriptProductionBlockers(d.approvedScript), ...checkScript(d.approvedScript!, approvedStoryboardLength(d)!, kit?.mustSay)])];
  if (issues.length && !acceptWarnings) throw new Error(issues.join(" "));
  const weak = storyboardKeyframeFixes(shots);
  if (weak.length && !acceptWarnings) throw new Error(`Redraw keyframes ${weak.join(", ")} before requesting HD.`);
  if (!await localOcrAvailable()) throw new Error("Video QA requires local Tesseract and its configured language.");
  const qaReserve = 0.08 + shots.length * 0.03;
  if (qaReserve > cap) throw new Error(`Preflight: HD QA needs about $${qaReserve.toFixed(2)}, over the $${cap.toFixed(2)} cap.`);
  const router = await openrouterCredits();
  if (router == null) throw new Error(ROUTER_UNREACHABLE);
  if (router < 0.05) throw new Error(`OpenRouter has $${router.toFixed(2)} left, too low for the required review. Check Credits and Guardrails.`);
  const refs = await Promise.all((d.productRefs ?? []).slice(0, 2).map(mediaDataUrl));
  const firsts = await Promise.all(shots.map((s) => mediaDataUrl(s.keyframe!)));
  const clips: { shotId: string; url: string; model: string; qa: ShotQA | null }[] = [];
  const methods = new Set<string>();
  for (const [i, c] of take.clips.entries()) {
    await step(run, d, `Upscaling shot ${i + 1}/${take.clips.length} locally (no new generation)`, 1 + i, total, "upscaling", { i, stage: "upscaling" });
    const up = await upscaleClip(await mediaDataUrl(c.url), 1080);
    shotDone(run, i, true);
    methods.add(up.method);
    const shot = shots.find((s) => s.id === c.shotId);
    clips.push({ shotId: c.shotId, url: await storeMedia(up.url, `${run.id}/${d.id}-${c.shotId}-hd-${randomUUID()}`), model: c.model, qa: shot?.clip === c.url ? shot.clipQa ?? null : null });
  }
  if (methods.has("lanczos")) warnings.push("Real-ESRGAN wasn't available for every shot, so a Lanczos resize was used. Install it for sharper HD.");
  const done = await assembleAndReview(run, d, { tier: "final", clips, voices: take.voices, music: take.music, spent, charge, warnings, issues, weak, refs, firsts, upscaledFrom: take.id });
  Object.assign(take, { upscaledCreativeId: done.creativeId, upscaledUrl: done.url, finalScore: done.quality.score });
  await saveRun(run);
  return { quality: done.quality, spent, warnings, take };
}

type Assembly = {
  tier: "draft" | "final";
  clips: { shotId: string; url: string; model: string; qa: ShotQA | null }[];
  voices: Voice[];
  music: string | null;
  spent: number;
  charge: (n: number) => void;
  warnings: string[];
  issues: string[];
  weak: number[];
  refs: string[];
  firsts: string[];
  upscaledFrom?: string;
};

/** Stitch, mix, typeset and run every export check (OCR, speech, WER, word timing, loudness, frames, craft). */
async function assembleAndReview(run: StudioRun, d: Direction, a: Assembly) {
  const { tier, charge, warnings, refs, firsts } = a;
  const shots = d.shots!;
  const plan = run.videoPlan!;
  const aspects = videoAspects(tier);
  const steps = jobSteps(tier, shots.length);
  const total = steps.total;
  const kit = await brandFor(run);
  await step(run, d, tier === "final" ? "Stitching the HD cut with the approved voice and music" : "Stitching shots, voice and music", steps.stitch, total, "stitching");
  const clipData = await Promise.all(a.clips.map((c) => mediaDataUrl(c.url)));
  const voiceData = await Promise.all(a.voices.map(async (v) => ({ ...v, url: await mediaDataUrl(v.url) })));
  const st = await stitchShots(clipData, {
    voices: voiceData, music: a.music ? await mediaDataUrl(a.music) : null, shotSeconds: shots.map((s) => s.seconds), width: tier === "final" ? 1080 : 486,
    beatSync: plan.beatSync !== false, sfx: plan.sfx === false ? [] : sfxCues(shots),
  });
  const lenOf = (i: number) => (st.starts[i + 1] ?? st.duration) - st.starts[i];
  // Where each line is actually spoken (voice start + its measured length at the applied tempo); captions follow it.
  const spans: ({ start: number; end: number } | undefined)[] = [];
  {
    let v = 0;
    for (const s of shots) {
      const k = s.vo.trim() ? v++ : -1;
      const voice = k >= 0 ? voiceData[k] : undefined;
      const at = k >= 0 ? st.voiceStarts?.[k] ?? voice!.start : 0; // after beat sync moved the line with its shot
      const len = voice ? await mediaDuration(voice.url).catch(() => 0) : 0;
      spans.push(voice && len > 0 ? { start: at, end: at + len / (voice.tempo || 1) } : undefined);
    }
  }
  const segments = shots.map((s, i) => ({ shotId: s.id, start: st.starts[i], end: st.starts[i] + lenOf(i), text: s.vo, onScreen: s.onScreen, speech: spans[i] }));
  const end = {
    brand: kit?.name && !kit.name.includes(".") ? kit.name : run.research?.brand || brandName(run.brandUrl),
    cta: d.approvedScript!.cta,
    // Offer line and footer badge from the brief's end-card mandatories (the writer leaves them to post).
    line: endCardItems(run.brief)[0],
    footer: endCardItems(run.brief)[1],
    color: kit?.colorRoles?.primary || run.research?.colors?.[0],
    logo: kit?.logo ? await mediaDataUrl(kit.logo).catch(() => null) : null,
    fontFile: kit?.font?.file ? await mediaFile(kit.font.file).catch(() => null) : null,
    fontFamily: kit?.font?.family ?? null,
  };
  await step(run, d, "QA: reading on-screen copy, checking speech and visuals", steps.qa, total, "qa");
  const capMode = captionMode(plan.captions);
  const cues = expectedCopy(segments, end, st.duration, capMode);
  const inspect = async (files: { aspect: string; url: string; copy?: CopyCue[] }[]) => (await Promise.all(files.map(async (v) => [
    // Read each line where it was actually placed (captions move off the product), end card from the fixed layout.
    ...await checkExport(v.url, v.aspect, st.duration + END_SECONDS, placedCues(v, cues)),
    ...await audioFindings(v.url, st.duration, v.aspect),
  ]))).flat();
  // Subject boxes for the caption-placement agent: where the product and hands are in each sampled frame.
  const subjects: { t: number; box: { x: number; y: number; w: number; h: number } | null; product?: { x: number; y: number; w: number; h: number } | null }[] = [];
  if (capMode !== "off") {
    for (const seg of segments) {
      const frames = await evidenceFrames(st.url, frameTimes(seg.start, seg.end)).catch(() => []);
      const r = await locateSubjects(run.models.vision, frames, `the ${end.brand} product`);
      charge(r.cost);
      subjects.push(...r.boxes);
    }
  }
  let variants = await captionVariants(st.url, "", end, segments, aspects, d.compactCopy, capMode, subjects);
  let findings = await inspect(variants);
  if (!d.compactCopy && findings.some((f) => f.kind === "copy" || (f.kind === "coverage" && f.aspect))) {
    variants = await captionVariants(st.url, "", end, segments, aspects, true, capMode, subjects);
    findings = await inspect(variants);
    d.compactCopy = true;
    warnings.push("Re-typeset the export after an on-screen copy mismatch; no shots were regenerated.");
  }
  const main = variants.find((v) => v.aspect === "9:16")!.url;
  const script = shots.map((s) => s.vo).join(" ");
  const speech = await verifySpeech(main, [...segments, { start: 0, end: st.duration + END_SECONDS, text: script }], transcribe, end.brand);
  charge(speech.cost);
  findings.push(...speech.findings);
  for (const finding of speech.findings) {
    if (finding.kind !== "speech") continue;
    const shot = shots.find((s) => s.id === finding.shotId);
    if (shot?.vo) delete shot.voiceTrack;
  }
  const mainVariant = variants.find((v) => v.aspect === "9:16")!;
  const moved = (mainVariant.agent ?? []).filter((x) => x.action !== "kept");
  if (moved.length) say(run, "agent", `Caption agent: ${moved.map((x) => `"${x.text}" ${x.action}${x.to_text ? ` to "${x.to_text}"` : ""}${x.reason ? ` (${x.reason})` : ""}`).join("; ")}.`);
  // Word sync checks the captions actually drawn on the main export (the agent may have shortened or dropped some).
  const drawn = mainVariant.copy?.filter((c) => c.layer === "caption") ?? cues.filter((c) => c.layer === "caption");
  const words = await wordLevelFindings(main, segments, script, plan.category, drawn, end.brand);
  findings.push(...words.findings);

  const evidence: VideoQuality["shots"] = [];
  for (const [i, s] of shots.entries()) {
    const segment = segments[i];
    const clipQa = a.clips[i]?.qa ?? null;
    let finalQa: ShotQA | undefined;
    if (shotReady(clipQa)) {
      try {
        const frames = await evidenceFrames(main, frameTimes(segment.start, segment.end), segment);
        // Median of three independent reviews (13.29): one export review swung 10 -> 4 on the identical cached clip
        // between takes, so a single sample decided the gate. The median keeps a flaw two of three reviewers see.
        const vs = await Promise.all([0, 1, 2].map(() => reviewShotFrames(run.models.vision, frames, capMode === "off" ? { ...s, onScreen: undefined } : s, refs, firsts[i], "export")));
        vs.forEach((v) => charge(v.cost));
        finalQa = medianReview(vs.map((v) => v.qa));
      } catch {
        finalQa = { score: 0, match: "review", notes: ["Final visual verification could not run."] };
      }
      const failures = finalQa.frames?.filter((f) => f.match === "fail") ?? [];
      if (failures.some((f) => f.repair === "layout")) d.compactCopy = true;
      if (tier === "draft" && failures.some((f) => f.repair === "source")) {
        s.clipQa = { ...finalQa, notes: [...finalQa.notes, ...(finalQa.frames ?? []).filter((f) => f.match === "fail").map((f) => f.note)] };
        s.status = "failed";
      }
    }
    const result = finalQa ?? clipQa;
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
  findings.push(...a.issues.map((issue) => ({ kind: "preflight" as const, at: 0, expected: "Script ready for HD", observed: issue, status: "review" as const })));
  for (const n of a.weak) {
    const segment = segments[n - 1];
    findings.push({ kind: "preflight", at: segment.start, shotId: segment.shotId, expected: `Keyframe match and ${QA_PASS}/10 before HD`, observed: `Keyframe ${n} still needs review.`, status: "review" });
  }
  const finalGate = stageScore("final", finalChecks({ craft: craft.score, findings, shotScores: evidence.map((e) => e.qa?.score ?? 0), captionSync: words.captionSync, frameScores: evidence.flatMap((e) => (e.qa?.frames ?? []).map((f) => (f.match === "pass" ? 10 : f.match === "review" ? 7 : 3))) }), run.models.vision, 1,
    [...craft.notes, ...findings.filter((f) => f.status === "fail").map((f) => `${f.at.toFixed(1)}s ${f.kind}: ${f.observed}`)].slice(0, 6));
  const stages = await takeStages(run, main, { shots, st, evidence, craft: craft.score, words, music: a.music, speechFails: speech.findings.filter((f) => f.kind === "speech" && f.status === "fail").length, charge, beats: d.approvedScript?.beats.map((b) => b.seconds), musicBeats: st.beats });
  for (const g of stages) saveStage(run, g, d.id);
  saveStage(run, finalGate, d.id);
  const quality = { ...exportVerdict(tier, craft.score, evidence, findings, variants.map((v) => v.aspect)), storyboardKey: d.storyboardKey!, rubric: finalGate.checks, rubricScore: finalGate.score };
  const pass = videoReady(quality);
  const result = { score: quality.score, pass, notes: [...findings.slice(0, 5).map((f) => f.observed), ...craft.notes] };
  const model = [...new Set(a.clips.map((c) => c.model))].join(" + ") + (a.upscaledFrom ? " (Real-ESRGAN HD)" : "");
  const creative = await saveCreative(run, d, { url: main, type: "video", model, variants, quality }, result, a.spent, null);
  run.job = null;
  return { quality, pass, url: creative?.mediaUrl ?? "", creativeId: creative?.id ?? null, stages };
}

/** Video, sound & voice and edit gates for one cut (see stage-gates.ts); one continuity vision call when AI is on. */
async function takeStages(run: StudioRun, main: string, o: {
  shots: Shot[]; st: { starts: number[]; duration: number }; evidence: VideoQuality["shots"]; craft: number; words: WordLevel; music: string | null; speechFails: number; charge: (n: number) => void; beats?: number[]; musicBeats?: number[];
}) {
  const plan = run.videoPlan!;
  const judge = gateJudge(run);
  const cal = await latestCalibration();
  const lines = o.shots.filter((s) => s.vo.trim()).length;
  const shotSeconds = o.shots.map((s, i) => (o.st.starts[i + 1] ?? o.st.duration) - o.st.starts[i]);
  let continuity: number | null = null;
  const notes: string[] = [];
  if (aiConfigured()) {
    try {
      const frames = (await Promise.all(o.shots.map((s, i) => evidenceFrames(main, [Number((o.st.starts[i] + shotSeconds[i] / 2).toFixed(3))])))).flat();
      const c = await judgeContinuity(judge, frames);
      o.charge(c.cost);
      continuity = c.score;
      notes.push(...c.notes);
    } catch {
      notes.push("Continuity judge could not run.");
    }
  }
  const cuts = await sceneCuts(main).catch(() => null);
  const video = stageScore("video", videoChecks(o.evidence.map((e) => e.qa), o.craft), run.models.vision, 1, o.evidence.flatMap((e) => e.qa?.notes ?? []).slice(0, 4), cal);
  const audio = stageScore("audio", audioChecks({ wer: o.words.wer, werVia: o.words.via, lufs: o.words.level?.lufs ?? null, peak: o.words.level?.peak ?? null, linesOutside: o.words.linesOutside, lines, musicPlanned: !!plan.music, musicPresent: !!o.music, speechFails: o.speechFails }), "rules", 1);
  const edit = stageScore("edit", editChecks({
    planned: o.st.starts.slice(1), detected: cuts?.cuts.filter((t) => t > 0.2 && t < o.st.duration - 0.2) ?? [], shotSeconds,
    beatSeconds: o.beats?.length === o.shots.length ? o.beats : o.shots.map((s) => s.seconds),
    wordsPerShot: o.shots.map((s) => s.vo.split(/\s+/).filter(Boolean).length), continuity,
    onBeat: o.musicBeats ? onBeatShare(o.st.starts.slice(1), o.musicBeats, 0.3) : null,
  }), judge, 1, notes, cal);
  return [video, audio, edit];
}

/** Word-by-word checks on the final mix: WER against the script, voice timing per shot, and lip sync when enabled. */
type WordLevel = { findings: QualityFinding[]; wer: number | null; via?: string; linesOutside: number; level: { lufs: number; peak: number } | null; captionSync?: number | null };

async function wordLevelFindings(main: string, segments: { shotId: string; start: number; end: number; text: string }[], script: string, category: string, captions: { start: number; end: number; text: string }[] = [], brand = ""): Promise<WordLevel> {
  const findings: QualityFinding[] = [];
  const timed = await wordTimings(main, asrVocabulary(script, brand)).catch(() => null); // same coined-term hint as the line checks (13.26)
  if (!timed) return { findings, wer: null, linesOutside: 0, level: await loudness(main).catch(() => null) };
  // Word-by-word: each caption cue against the words heard while it is on screen.
  const sync = captionSyncFindings(captionSync(captions, timed.words, 0.35, brand));
  findings.push(...sync.findings);
  let linesOutside = 0;
  const heard = timed.words.map((w) => w.word).join(" ");
  const { wer, via } = await werCheck(canonExpected(script), canonHeard(heard, script, brand)); // 13.23: compare spoken forms
  if (wer > 0.1) findings.push({ kind: "speech", at: 0, expected: `Narration matches the script (WER ≤ 10%, ${via})`, observed: `WER ${(wer * 100).toFixed(0)}%: heard “${heard.slice(0, 200)}”`, status: wer > 0.25 ? "fail" : "review" });
  for (const seg of segments) {
    if (!seg.text.trim()) continue;
    const inside = timed.words.filter((w) => w.start >= seg.start - 0.05 && w.start < seg.end);
    if (!inside.length) linesOutside++;
    if (!inside.length) findings.push({ kind: "speech", shotId: seg.shotId, at: seg.start, expected: `Voice inside its shot (${seg.start.toFixed(1)}–${seg.end.toFixed(1)}s, ${timed.via})`, observed: "No words were heard during this shot", status: "fail" });
  }
  const level = await loudness(main).catch(() => null);
  if (level && (Math.abs(level.lufs + 14) > 2 || level.peak > -1)) findings.push({ kind: "technical", at: 0, expected: "Mix at about -14 LUFS with a true peak under -1 dBFS", observed: `${level.lufs.toFixed(1)} LUFS, peak ${level.peak.toFixed(1)} dBFS`, status: "review" });
  if (category === "ugc_testimonial") {
    const sync = await lipSync(main);
    if (sync && (Math.abs(sync.offset) > 3 || sync.confidence < 3)) findings.push({ kind: "speech", at: 0, expected: "Lip sync within 3 frames (SyncNet)", observed: `Offset ${sync.offset} frames, confidence ${sync.confidence.toFixed(1)}`, status: "review" });
  }
  return { findings, wer, via, linesOutside, level, captionSync: sync.score };
}

async function checkedVoice(line: string, voice: string, charge: (n: number) => void, onTry?: (n: number) => void, brand = "", pronunciation = "") {
  let last = "";
  for (let i = 0; i < 2; i++) {
    onTry?.(i + 1);
    const v = await voiceover(line, voice, { brand, pronunciation });
    charge(v.usage.costUsd);
    const heard = await transcribeLine(v.url, transcribe, asrVocabulary(line, brand));
    charge(heard.usage.costUsd);
    if (nearSpeech(heard.text, line, brand)) return v.url;
    last = heard.text;
  }
  throw new Error(`The narration did not match an approved line after two attempts (expected “${line}”, heard “${last.slice(0, 160)}”). Check pronunciation or reapprove revised wording before video spend.`);
}
