import { planAudio, type AudioShot } from "@/lib/audio/mode";
import { checkPreviewShots, type ShotCheckDeps, type ShotVerdict } from "@/lib/qa/shot-check";
import { finalReview, type FinalDeps } from "@/lib/qa/final-review";
import { qaGates } from "@/lib/qa/config";
import { type CacheStore, fileCache, inputHash } from "@/lib/render/cache";
import { BudgetExceeded, CostMeter, withMeter } from "@/lib/render/cost-meter";
import { renderRouted, routeShot, type RendererSet } from "@/lib/render/router";
import { runParallel } from "@/lib/render/scheduler";
import { rowFromSheetShot, type RenderContext, type RenderMode, type ShotRow } from "@/lib/render/types";
import { dur, type SheetShot, type ShotSheet } from "@/lib/shot-sheet";
import type { SfxCue } from "@/lib/sfx";
import { ledger, nowIso, saveProgress } from "./jobs";
import type { CostEntry, FinalResult, SheetRun, ShotRender, Version } from "./run-types";
import { getPresetsWithCosts, normalizeStack, type VersionStack } from "@/lib/versions";
import { editorInstructions } from "./editor";
import { shotsForStack } from "./version-estimate";
export { blenderOnly, estimateSheetVersion, SHOT_CHECK_USD, shotsForStack, videoPricePerSec } from "./version-estimate";



/**
 * The render half of the Studio flow (steps 4 and 5): shot sheet in, previews and a final out.
 * Everything that costs money or touches a machine is injected (`RenderDeps`), so the whole flow is testable with
 * mocks: routing per shot, parallel renders with isolation and one retry, caching by input hash, the server-side cap,
 * check 2 (one cheap look per preview shot), the audio plan, and check 3 (strict median-of-3 final).
 */
export interface Stitched { url: string; starts: number[]; duration: number }

export interface RenderDeps {
  renderers: RendererSet;
  /** Product photos as data URLs (the Blender renderer unwraps the real label from one). */
  photos(run: SheetRun): Promise<string[]>;
  /** Persists a data URL and returns a stable URL. */
  store(data: string, key: string): Promise<string>;
  shotCheck: ShotCheckDeps;
  stitch(clips: string[], audio: { voices: { url: string; start: number }[]; sfx: SfxCue[]; duck: boolean; bedGain: number; music: string | null; shotSeconds: number[]; width: number; height?: number }): Promise<Stitched>;
  /** A free synthesised bed (drone) for the sheet's "bed" line, as a data URL; null for none. */
  bed?(description: string, seconds: number): Promise<string | null>;
  /** Voiceover for a line (vo mode only). Gated by the meter like every paid call. */
  voice?(line: string, run: SheetRun): Promise<{ url: string; usd: number }>;
  final: (video: string, run: SheetRun, stitched: Stitched) => FinalDeps;
  clipCache: CacheStore<{ url: string; renderer: string; model: string }>;
  judgeCache: CacheStore<ShotVerdict>;
  concurrency?: number;
  /** RENDER_AUTO_BLENDER: send product shots to Blender when the row does not say. */
  autoBlender?: boolean;
  /** Version stack models to override defaults per stage. */
  stackModels?: Partial<Record<string, string>>;
}

const WIDTH: Record<ShotSheet["aspect"], [number, number]> = { "16:9": [1280, 720], "9:16": [720, 1280], "1:1": [1024, 1024] };
const FINAL_WIDTH: Record<ShotSheet["aspect"], [number, number]> = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080] };

export const concurrencyFromEnv = () => Math.max(1, Math.min(8, Number(process.env.RENDER_CONCURRENCY) || 4));

/** The sheet row's own prompt, else one built from its columns (the enhancer normally writes it). */
export function promptFor(s: SheetShot): string {
  return s.prompt?.trim() || [`${s.shotType}: ${s.subject}`, s.action, s.framing && `Framing: ${s.framing}`, `Camera: ${s.camera.angle}, ${s.camera.move}, ${s.camera.lensMm}mm`, s.lighting && `Light: ${s.lighting}`].filter(Boolean).join(". ");
}

export const audioShots = (sheet: ShotSheet): AudioShot[] => sheet.shots.map((s) => ({ seconds: dur(s), visual: `${s.subject}. ${s.action}`, vo: s.audio.vo, sfx: s.audio.sfx }));

/** One shot's cache key: any change to what is rendered changes it, nothing else does. */
export const clipKey = (s: SheetShot, mode: RenderMode, photoSig: string, size: [number, number], videoModel = "", palette = "") =>
  inputHash("sheet-clip-v2", mode, size, photoSig, rowFromSheetShot(s, {}, palette), promptFor(s), s.engine === "blender" || s.engine === "remotion" ? "" : videoModel);



const nextVersionId = (run: SheetRun, tier: Version["tier"]) => `${run.id}-${tier === "preview" ? "p" : "f"}${run.versions.filter((v) => v.tier === tier).length + 1}`;

function addTiming(run: SheetRun, stage: string, ms: number, note?: string) {
  run.timings.push({ stage, ms, at: nowIso(), ...(note ? { note } : {}) });
}

export interface RenderOutcome { version: Version; stitched: Stitched | null; meter?: CostMeter }

/**
 * Renders every shot of the sheet in parallel (limit 4), stitches with the planned audio and returns the version.
 * `tier` "preview" renders cheap (EEVEE, 480p) and runs check 2; "final" renders at full quality.
 */
export async function renderSheetVersion(run: SheetRun, deps: RenderDeps, o: { tier: Version["tier"]; versionId?: string; stack?: VersionStack }): Promise<RenderOutcome> {
  const sheet = run.sheet;
  if (!sheet) throw new Error("Write the shot sheet first.");
  if (run.gate && !run.gate.pass) throw new Error("The shot sheet gate has errors. Fix them before rendering.");
  const mode: RenderMode = o.tier === "preview" ? "preview" : "final";
  const [width, height] = (mode === "preview" ? WIDTH : FINAL_WIDTH)[sheet.aspect];
  const t0 = Date.now();
  const spent0 = run.cost.spentUsd;

  let version = run.versions.find((v) => v.id === o.versionId);
  if (!version) {
    // Create a new version with a proper default stack from presets
    const defaultStack = o.stack ?? normalizeStack(getPresetsWithCosts({ shots: sheet.shots.length, targetSec: sheet.targetSec })[0]);
    version = { 
      id: nextVersionId(run, o.tier), 
      stack: defaultStack, 
      tier: o.tier, 
      status: "queued", 
      estimate: null, 
      shots: [], 
      videoUrl: null, 
      contactUrl: null, 
      usd: 0, 
      ms: 0 
    };
    run.versions.push(version);
  }
  if (!version) throw new Error("Failed to create or find version");
  const v = version;
  const refs = await deps.photos(run);
  const photoSig = inputHash(refs.map((r) => r.length + r.slice(-64)));
  const shots = shotsForStack(sheet, v.stack);
  const videoModel = v.stack?.models?.video && v.stack.models.video !== "auto" ? v.stack.models.video : "";
  const rows = shots.map((s) => ({ s, row: rowFromSheetShot(s, {}, sheet.palette) as ShotRow }));
  const accent = sheet.palette.match(/#[0-9a-fA-F]{6}/)?.[0];
  const card = { brand: sheet.endCard.title, line: sheet.endCard.line || undefined, footer: sheet.endCard.footer || undefined, ...(accent ? { accent } : {}) };
  const ctxFor = (s: SheetShot): RenderContext => ({ mode, width, height, refs, prompt: promptFor(s), resolution: mode === "preview" ? "480p" : "720p", ...(s.engine === "remotion" ? { card } : {}) });
  const keys = rows.map(({ s }) => clipKey(s, mode, photoSig, [width, height], videoModel, sheet.palette));

  // Preflight: what the paid shots still to render would cost, against what is left of the cap. Nothing is spent when it does not fit.
  const stage = mode === "preview" ? "previews" : "final";
  const meter = new CostMeter({
    capUsd: run.cost.capUsd, spentUsd: run.cost.spentUsd, onChange: (s) => { run.cost.spentUsd = s.spentUsd; },
    // Every paid call (clips, shot checks, voice, the final review) lands on the run and in the operator's ledger.
    onCharge: (c) => { const e: CostEntry = { at: c.at, stage, what: `${v.stack?.label ?? v.id}: ${c.label}`, model: c.label.replace(/^[a-z]+:/, ""), usd: c.usd, estimate: c.estimated }; run.cost.entries.push(e); ledger(run, e); },
  });
  const pending = await Promise.all(rows.map(async ({ s, row }, i) => {
    if (await deps.clipCache.get(keys[i])) return { id: s.id, usd: 0 };
    const r = deps.renderers[routeShot(row, { hasProductRef: refs.length > 0, autoBlender: deps.autoBlender }).renderer];
    return { id: s.id, usd: r ? Math.max(0, r.estimateUsd(row, ctxFor(s))) : 0 };
  }));
  const estimate = Number(pending.reduce((a, p) => a + p.usd, 0).toFixed(4));
  v.estimate = { usd: estimate, lines: pending.filter((p) => p.usd > 0).map((p) => ({ what: `shot ${p.id}`, model: "ai-video", usd: p.usd })), blocked: [] };
  const left = meter.snapshot().remainingUsd;
  if (estimate > left + 1e-9) {
    v.status = "refused";
    v.estimate.blocked = [`This render needs about $${estimate.toFixed(2)} but $${left.toFixed(2)} of the $${run.cost.capUsd.toFixed(2)} cap is left. Raise the cap or change shots to free engines.`];
    v.error = v.estimate.blocked[0];
    await saveProgress(run);
    return { version: v, stitched: null };
  }

  v.status = "rendering";
  v.shots = rows.map(({ s }) => ({ shotId: s.id, engine: s.engine, model: "", url: null, cached: false, ms: 0, usd: 0 }));
  await saveProgress(run);

  const results = await withMeter(meter, () => runParallel(rows.map(({ s, row }, i) => ({
    id: s.id, key: keys[i], stage: "shot", renderer: row.renderer === "auto" ? undefined : row.renderer,
    run: async () => {
      const out = await renderRouted(row, ctxFor(s), deps.renderers, { autoBlender: deps.autoBlender });
      const url = await deps.store(out.url, `${run.id}/${s.id}-${keys[i].slice(0, 12)}`);
      const rec: ShotRender = v.shots[i];
      Object.assign(rec, { url, engine: out.renderer, model: out.note ?? out.renderer, usd: out.costUsd, ms: out.ms ?? 0, fallback: out.fellBackFrom ? `${out.fellBackFrom} → ${out.renderer}` : null });
      return { url, renderer: out.renderer as string, model: out.note ?? out.renderer };
    },
  })), { limit: deps.concurrency ?? concurrencyFromEnv(), retries: 1, cache: deps.clipCache }));

  results.forEach((r, i) => {
    const rec = v.shots[i];
    if (r.status === "failed") Object.assign(rec, { error: r.error!.message });
    else Object.assign(rec, { url: r.value!.url, engine: r.value!.renderer, cached: r.status === "cached", ms: r.ms, ...(r.status === "cached" ? { usd: 0 } : {}) });
    addTiming(run, `${mode} shot ${i + 1}`, r.ms, r.status === "cached" ? "cached" : r.status === "failed" ? "failed" : r.value?.renderer);
  });
  const failed = v.shots.filter((s) => s.error);
  v.usd = Number((meter.snapshot().spentUsd - spent0).toFixed(4));
  if (failed.length) {
    Object.assign(v, { status: "failed", ms: Date.now() - t0, error: `${failed.length} shot(s) failed: ${failed.map((f) => `${f.shotId}: ${f.error}`).join("; ").slice(0, 400)}. The shots that rendered were kept.` });
    await saveProgress(run);
    return { version: v, stitched: null };
  }

  // Check 2: one cheap look per preview shot (never on a final: its check is the strict review below).
  if (mode === "preview" && qaGates().mode === "consolidated") {
    const t1 = Date.now();
    const verdicts = await withMeter(meter, () => checkPreviewShots(rows.map(({ s }, i) => ({ id: s.id, expected: `${s.subject}. ${s.action}`, clip: v.shots[i].url!, seconds: dur(s) })), deps.shotCheck, { cache: deps.judgeCache, model: run.input.visionModel, limit: deps.concurrency ?? concurrencyFromEnv() }));
    v.shots.forEach((r) => { const c = verdicts[r.shotId]; if (c) r.check = { score: c.score, note: c.note }; });
    const scores = v.shots.flatMap((r) => (r.check ? [r.check.score] : []));
    v.score = scores.length ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)) : null;
    addTiming(run, "shot checks", Date.now() - t1);
  }

  // Audio: the plan decides who carries the sound; stitchShots mixes it.
  const t2 = Date.now();
  const plan = planAudio(run.input.audioMode, audioShots({ ...sheet, shots }));
  const voices: { url: string; start: number }[] = [];
  if (plan.voice && deps.voice) {
    for (const [i, s] of shots.entries()) {
      if (!s.audio.vo) continue;
      const line = await withMeter(meter, () => deps.voice!(s.audio.vo!, run));
      voices.push({ url: line.url, start: sheet.shots.slice(0, i).reduce((a, x) => a + dur(x), 0) + 0.15 });
    }
  }
  const total = shots.reduce((a, x) => a + dur(x), 0);
  const music = sheet.bed?.trim() && deps.bed ? await deps.bed(sheet.bed, total) : null;
  const stitched = await deps.stitch(v.shots.map((r) => r.url!), { voices, sfx: plan.sfx, duck: plan.duck, bedGain: plan.bedGain, music, shotSeconds: sheet.shots.map(dur), width, height });
  v.videoUrl = await deps.store(stitched.url, `${run.id}/${v.id}-cut`);
  addTiming(run, "edit and mix", Date.now() - t2, `audio: ${plan.mode}${plan.unmapped.length ? `, no sound for ${plan.unmapped.length} action(s)` : ""}`);
  Object.assign(v, { status: "done", ms: Date.now() - t0, error: null });
  v.usd = Number((meter.snapshot().spentUsd - spent0).toFixed(4));
  await saveProgress(run);
  return { version: v, stitched, meter };
}

/** Step 4: render the previews (or a queued version) and keep the result on the run. */
export async function runPreviews(run: SheetRun, deps: RenderDeps, o: { versionId?: string } = {}) {
  // Pass the version's stack models through deps
  const version = run.versions.find((v) => v.id === o.versionId) || run.versions[0];
  const depsWithStack = { ...deps, stackModels: version?.stack.models };
  const { version: result } = await renderSheetVersion(run, depsWithStack, { tier: "preview", versionId: o.versionId });
  run.step = "previews";
  await saveProgress(run);
  return result;
}

/** The version Final renders: the operator's pick, else the best-scored finished preview. */
export function pickedVersion(run: SheetRun): Version | undefined {
  const previews = run.versions.filter((v) => v.tier === "preview");
  const picked = run.picks?.video ? previews.find((v) => v.id === run.picks.video) : undefined;
  if (picked) return picked;
  return previews.filter((v) => v.status === "done").sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] ?? previews[0];
}

/** Step 5: render at final quality, then check 3 (median of 3 + loudness, OCR spelling, Whisper sync). */
export async function runFinal(run: SheetRun, deps: RenderDeps): Promise<FinalResult | null> {
  // The winner the operator picked (pick_winner), else the best-scored finished preview.
  const winner = pickedVersion(run);
  const spentBefore = run.cost.spentUsd;
  const depsWithStack = { ...deps, stackModels: winner?.stack.models };
  const { version, stitched, meter } = await renderSheetVersion(run, depsWithStack, { tier: "final", stack: winner?.stack });
  if (!stitched || version.status !== "done") throw new Error(version.error ?? "The final render did not finish.");
  const t0 = Date.now();
  // Check 3 runs inside the run's meter, so its calls are capped and logged like every other paid call.
  const review = () => finalReview(depsWithStack.final(version.videoUrl!, run, stitched), { reviews: qaGates().finalReviews });
  const report = meter ? await withMeter(meter, review) : await review();
  version.usd = Number((run.cost.spentUsd - spentBefore).toFixed(4));
  version.score = report.score;
  run.final = {
    videoUrl: version.videoUrl!, contactUrl: null, score: report.score, rubric: report.rubric, reviews: report.reviews, notes: report.notes,
    usd: version.usd, ms: version.ms + (Date.now() - t0), editorNotes: run.sheet ? editorInstructions(run.sheet) : "", creativeId: null,
  };
  addTiming(run, "final review", Date.now() - t0, `median of ${report.reviews.length}`);
  run.step = "final";
  await saveProgress(run);
  return run.final;
}

export { BudgetExceeded };
