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
import { blenderQueue } from "@/lib/render/blender-queue";
import { shotsForStack } from "./version-estimate";
export { blenderOnly, estimateSheetVersion, SHOT_CHECK_USD, shotsForStack, videoPricePerSec } from "./version-estimate";

/** Builds caption cues from chunked captions in the sheet, timed to shot starts. */
function buildChunkedCaptions(sheet: ShotSheet, shotStarts: number[]): { start: number; end: number; text: string }[] {
  const cues: { start: number; end: number; text: string }[] = [];
  let brightLabelAdded = false;
  
  for (let i = 0; i < sheet.shots.length; i++) {
    const shot = sheet.shots[i];
    const shotStart = shotStarts[i] ?? 0;
    const shotDur = dur(shot);
    
    // Add bright label in first 3s if present
    if (!brightLabelAdded && shot.text?.copy && shotStart < 3) {
      cues.push({ start: shotStart, end: Math.min(shotStart + 0.8, shotStart + shotDur, 3), text: shot.text.copy });
      brightLabelAdded = true;
    }
    
    // Add chunked captions if present
    if (shot.text?.chunks && shot.text.chunks.length > 0) {
      const chunkDur = shotDur / shot.text.chunks.length;
      shot.text.chunks.forEach((chunk, j) => {
        cues.push({ start: shotStart + j * chunkDur, end: shotStart + (j + 1) * chunkDur, text: chunk });
      });
    }
  }
  
  return cues;
}

/**
 * The render half of the Studio flow (steps 4 and 5): shot sheet in, previews and a final out.
 * Everything that costs money or touches a machine is injected (`RenderDeps`), so the whole flow is testable with
 * mocks: routing per shot, parallel renders with isolation and one retry, caching by input hash, the server-side cap,
 * check 2 (one cheap look per preview shot), the audio plan, and check 3 (strict median-of-3 final).
 */
export interface Stitched { url: string; starts: number[]; duration: number }

export type GeneratedSfxCue = { kind: "generated"; shot: number; offset: number; gain: number; url: string };

export interface RenderDeps {
  renderers: RendererSet;
  /** Product photos as data URLs (the Blender renderer unwraps the real label from one). */
  photos(run: SheetRun): Promise<string[]>;
  /** Persists a data URL and returns a stable URL. */
  store(data: string, key: string): Promise<string>;
  shotCheck: ShotCheckDeps;
  stitch(clips: string[], audio: { voices: { url: string; start: number }[]; sfx: (SfxCue | GeneratedSfxCue)[]; duck: boolean; bedGain: number; music: string | null; shotSeconds: number[]; width: number; height?: number; silenceGaps?: { start: number; end: number }[] }): Promise<Stitched>;
  /** A free synthesised bed (drone) for the sheet's "bed" line, as a data URL; null for none. */
  bed?(description: string, seconds: number): Promise<string | null>;
  /** Voiceover for a line (vo mode only). Gated by the meter like every paid call. */
  voice?(line: string, run: SheetRun, voiceName?: string): Promise<{ url: string; usd: number }>;
  /** Sound design: per-video audio plan from the sheet, brief and pattern. */
  soundDesign?(run: SheetRun): Promise<{ sfx: { description: string; shot: number; offset: number; gain: number }[]; music: { type: "none" } | { type: "cue"; prompt: string }; voice: { gender: string; age: string; energy: string; pace: string } } | null>;
  /** Select voice from persona and brand. */
  selectVoice?(persona: { gender: string; age: string; energy: string; pace: string }, brand: string): string;
  /** Generate SFX from video clip (video-to-audio). */
  generateSfx?(videoUrl: string, textPrompt: string, durationSeconds: number): Promise<{ url: string; usd: number }>;
  /** Generate music from text prompt. */
  generateMusic?(prompt: string, seconds: number): Promise<string>;
  /** Burns chunked captions into a video for pattern-aware sheets. */
  burnCaptions?(video: string, cues: { start: number; end: number; text: string }[], width: number, height: number): Promise<string>;
  /** Job context for queue management (optional, used when rendering through the queue). */
  jobContext?: { runId: string; versionId: string; jobId: string };
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
  
  // Honor gate override, but still block on claim or safety errors
  if (run.gate && !run.gate.pass && !run.gateOverride) {
    throw new Error("The shot sheet gate has errors. Fix them before rendering.");
  }
  if (run.gate && !run.gate.pass && run.gateOverride) {
    const blockingErrors = run.gate.issues.filter((i) => i.level === "error");
    const claimOrSafetyErrors = blockingErrors.filter((i) =>
      i.text.includes("claims") ||
      i.text.includes("unverified") ||
      i.text.includes("facts mark as") ||
      i.text.includes("verified facts don't support")
    );
    if (claimOrSafetyErrors.length > 0) {
      throw new Error("Cannot override claim or safety errors. Fix them before rendering.");
    }
  }
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
  
  // Select end-card layout based on concept
  const { selectEndCardLayout } = await import("@/../remotion/EndCardLayouts");
  const chosenConcept = run.concepts?.concepts.find((c) => c.id === run.concepts?.chosenId);
  const cardLayout = selectEndCardLayout(chosenConcept, refs.length > 0);
  
  const card = { 
    brand: sheet.endCard.title, 
    line: sheet.endCard.line || undefined, 
    footer: sheet.endCard.footer || undefined, 
    layout: cardLayout,
    ...(accent ? { accent } : {}),
    ...(refs.length > 0 ? { productPhoto: refs[0] } : {}),
  };
  const ctxFor = (s: SheetShot): RenderContext => {
    const jobId = deps.jobContext ? `${deps.jobContext.jobId}-${s.id}` : undefined;
    const signal = jobId ? blenderQueue.getSignal(jobId) : undefined;
    
    // Use character reference as first frame for people shots
    let firstFrame: string | undefined;
    if (s.engine === "ai_video" && sheet.character?.referenceUrl) {
      const isPeopleShot = /\b(person|people|man|woman|actor|hand|face)\b/i.test(`${s.subject} ${s.prompt ?? ""}`);
      if (isPeopleShot) {
        firstFrame = sheet.character.referenceUrl;
      }
    }
    
    // Build prompt with anti-text guidance when shot has text copy
    let enhancedPrompt = promptFor(s);
    if (s.engine === "ai_video" && s.text?.copy) {
      // Add guidance to prevent AI from drawing garbled text
      enhancedPrompt += ". No text, no letters, no words, no signage, no labels visible in the scene; text will be added in post-production.";
    }
    
    return { 
      mode, 
      width, 
      height, 
      refs, 
      firstFrame,
      prompt: enhancedPrompt, 
      resolution: mode === "preview" ? "480p" : "720p", 
      signal, 
      ...(s.engine === "remotion" ? { card } : {}) 
    };
  };
  const keys = rows.map(({ s }) => clipKey(s, mode, photoSig, [width, height], videoModel, sheet.palette));

  // Check if we can reuse preview clips for the final (when unchanged and reRenderAllForFinal is false)
  const reusablePreviewClips = new Map<string, { url: string; model: string; renderer: string }>();
  if (mode === "final" && !run.input.reRenderAllForFinal) {
    const winningPreview = run.versions.find((pv) => pv.tier === "preview" && pv.id === run.picks.video && pv.status === "done");
    if (winningPreview && winningPreview.stack) {
      // Compare shots: reuse if prompt, model, duration, and first frame are unchanged
      const previewVideoModel = winningPreview.stack.models?.video && winningPreview.stack.models.video !== "auto" ? winningPreview.stack.models.video : "";
      const finalVideoModel = v.stack?.models?.video && v.stack.models.video !== "auto" ? v.stack.models.video : "";
      
      for (let i = 0; i < shots.length && i < winningPreview.shots.length; i++) {
        const finalShot = shots[i];
        const previewShot = sheet!.shots[i]; // Original preview sheet shot
        const previewRender = winningPreview.shots[i];
        
        // Check if shot is unchanged: same prompt, model, duration, first frame, and engine
        const promptUnchanged = promptFor(finalShot) === promptFor(previewShot);
        const modelUnchanged = previewVideoModel === finalVideoModel;
        const durationUnchanged = Math.abs(dur(finalShot) - dur(previewShot)) < 0.1;
        const firstFrameUnchanged = (finalShot.engine !== "ai_video" || !ctxFor(finalShot).firstFrame) && 
                                     (previewShot.engine !== "ai_video" || !sheet.character?.referenceUrl);
        const engineUnchanged = finalShot.engine === previewShot.engine;
        
        if (promptUnchanged && modelUnchanged && durationUnchanged && firstFrameUnchanged && engineUnchanged && 
            previewRender.url && !previewRender.error) {
          // This shot can be reused - mark it for upscaling
          reusablePreviewClips.set(finalShot.id, {
            url: previewRender.url,
            model: previewRender.model,
            renderer: previewRender.engine
          });
        }
      }
    }
  }

  // Preflight: what the paid shots still to render would cost, against what is left of the cap. Nothing is spent when it does not fit.
  const stage = mode === "preview" ? "previews" : "final";
  const meter = new CostMeter({
    capUsd: run.cost.capUsd, spentUsd: run.cost.spentUsd, onChange: (s) => { run.cost.spentUsd = s.spentUsd; },
    // Every paid call (clips, shot checks, voice, the final review) lands on the run and in the operator's ledger.
    onCharge: (c) => { const e: CostEntry = { at: c.at, stage, what: `${v.stack?.label ?? v.id}: ${c.label}`, model: c.label.replace(/^[a-z]+:/, ""), usd: c.usd, estimate: c.estimated }; run.cost.entries.push(e); ledger(run, e); },
  });
  const pending = await Promise.all(rows.map(async ({ s, row }, i) => {
    if (await deps.clipCache.get(keys[i])) return { id: s.id, usd: 0, reusable: false };
    if (reusablePreviewClips.has(s.id)) return { id: s.id, usd: 0, reusable: true };
    const r = deps.renderers[routeShot(row, { hasProductRef: refs.length > 0, autoBlender: deps.autoBlender }).renderer];
    return { id: s.id, usd: r ? Math.max(0, r.estimateUsd(row, ctxFor(s))) : 0, reusable: false };
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

  const results = await withMeter(meter, () => runParallel(rows.map(({ s, row }, i) => {
    const reusable = reusablePreviewClips.get(s.id);
    return {
      id: s.id,
      key: keys[i],
      stage: "shot",
      renderer: row.renderer === "auto" ? undefined : row.renderer,
      run: async () => {
        // If we can reuse a preview clip, upscale it instead of rendering
        if (reusable) {
          const { upscaleClip } = await import("@/lib/upscale");
          const upscaled = await upscaleClip(reusable.url, width);
          const url = await deps.store(upscaled.url, `${run.id}/${s.id}-${keys[i].slice(0, 12)}-upscaled`);
          const rec: ShotRender = v.shots[i];
          Object.assign(rec, { 
            url, 
            engine: reusable.renderer, 
            model: `${reusable.model} (reused from preview, ${upscaled.method} upscale)`, 
            usd: 0, 
            ms: 0, 
            fallback: null 
          });
          return { url, renderer: reusable.renderer, model: reusable.model };
        }
        
        // Normal render path
        const out = await renderRouted(row, ctxFor(s), deps.renderers, { autoBlender: deps.autoBlender });
        const url = await deps.store(out.url, `${run.id}/${s.id}-${keys[i].slice(0, 12)}`);
        const rec: ShotRender = v.shots[i];
        Object.assign(rec, { url, engine: out.renderer, model: out.note ?? out.renderer, usd: out.costUsd, ms: out.ms ?? 0, fallback: out.fellBackFrom ? `${out.fellBackFrom} → ${out.renderer}` : null });
        return { url, renderer: out.renderer as string, model: out.note ?? out.renderer };
      },
    };
  }), { limit: deps.concurrency ?? concurrencyFromEnv(), retries: 1, cache: deps.clipCache }));

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

  // Start sound design in parallel with shot checks (both are cheap LLM calls)
  const soundDesignPromise = (async () => {
    if (deps.soundDesign) {
      try {
        return await withMeter(meter, () => deps.soundDesign!(run));
      } catch (e) {
        console.warn(`[audio] Sound design failed: ${(e as Error).message}, using fallback`);
        return null;
      }
    }
    return null;
  })();

  // Check 2: one cheap look per preview shot (never on a final: its check is the strict review below).
  if (mode === "preview" && qaGates().mode === "consolidated") {
    const t1 = Date.now();
    const verdicts = await withMeter(meter, () => checkPreviewShots(rows.map(({ s }, i) => ({ id: s.id, expected: `${s.subject}. ${s.action}`, clip: v.shots[i].url!, seconds: dur(s) })), deps.shotCheck, { cache: deps.judgeCache, model: run.input.visionModel, limit: deps.concurrency ?? concurrencyFromEnv() }));
    v.shots.forEach((r) => { const c = verdicts[r.shotId]; if (c) r.check = { score: c.score, note: c.note }; });
    const scores = v.shots.flatMap((r) => (r.check ? [r.check.score] : []));
    v.score = scores.length ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)) : null;
    addTiming(run, "shot checks", Date.now() - t1);
  }

  // Audio: wait for sound design, then generation and mixing with bounded concurrency.
  const t2 = Date.now();
  const soundDesign = await soundDesignPromise;
  
  // Fallback to old behavior if sound design unavailable
  const plan = planAudio(run.input.audioMode, audioShots({ ...sheet, shots }));
  const voices: { url: string; start: number }[] = [];
  
  // Step 2: Generate voiceovers with selected voice - parallel with bounded concurrency
  if (plan.voice && deps.voice) {
    const brandName = run.brief?.objective || "Brand";
    const voiceName = soundDesign?.voice ? deps.selectVoice?.(soundDesign.voice, brandName) : undefined;
    
    // Collect voice tasks
    const voiceTasks = shots
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.audio.vo)
      .map(({ s, i }) => async () => {
        const line = await withMeter(meter, () => deps.voice!(s.audio.vo!, run, voiceName));
        return { url: line.url, start: sheet.shots.slice(0, i).reduce((a, x) => a + dur(x), 0) + 0.15 };
      });
    
    // Run with bounded concurrency (4 at a time)
    const concurrency = 4;
    for (let i = 0; i < voiceTasks.length; i += concurrency) {
      const batch = voiceTasks.slice(i, i + concurrency);
      const results = await Promise.all(batch.map(task => task()));
      voices.push(...results);
    }
  }
  
  // Step 3: Generate SFX from video clips - parallel with bounded concurrency
  const generatedSfx: { url: string; shot: number; offset: number; gain: number }[] = [];
  const sfxFailures: string[] = [];
  if (soundDesign?.sfx && deps.generateSfx) {
    // Collect SFX tasks
    const sfxTasks = soundDesign.sfx
      .filter(cue => cue.shot < v.shots.length && v.shots[cue.shot].url)
      .map(cue => async () => {
        const shotRender = v.shots[cue.shot];
        try {
          const result = await withMeter(meter, () => 
            deps.generateSfx!(shotRender.url!, cue.description, Math.min(5, cue.offset + 3))
          );
          return { success: true as const, url: result.url, shot: cue.shot, offset: cue.offset, gain: cue.gain, description: cue.description };
        } catch (e) {
          const errorMsg = `SFX generation failed for shot ${cue.shot + 1} ("${cue.description}"): ${(e as Error).message}`;
          console.error(`[audio] ${errorMsg}`);
          return { success: false as const, shot: cue.shot, description: cue.description, error: errorMsg };
        }
      });
    
    // Run with bounded concurrency (4 at a time)
    const concurrency = 4;
    for (let i = 0; i < sfxTasks.length; i += concurrency) {
      const batch = sfxTasks.slice(i, i + concurrency);
      const results = await Promise.all(batch.map(task => task()));
      for (const result of results) {
        if (result.success) {
          generatedSfx.push({ url: result.url, shot: result.shot, offset: result.offset, gain: result.gain });
        } else {
          sfxFailures.push(result.error);
        }
      }
    }
  }
  
  // Log SFX failures loudly in run activity/notes so operator sees them
  if (sfxFailures.length > 0) {
    const failureNote = `⚠️ ${sfxFailures.length} SFX generation failure(s): ${sfxFailures.join("; ")}`;
    console.warn(`[audio] ${failureNote}`);
    // Add to run's editor notes or a failure log field
    if (!v.error) {
      v.error = failureNote;
    }
  }
  
  // Step 4: Generate music from sound design plan
  const total = shots.reduce((a, x) => a + dur(x), 0);
  
  // Compute silence gaps for pattern-specific beats (e.g. ~1s after but_silence)
  const silenceGaps: { start: number; end: number }[] = [];
  if (sheet.patternId === "confession_loop") {
    const butSilenceIdx = sheet.shots.findIndex((s) => s.beat === "but_silence");
    if (butSilenceIdx >= 0) {
      const beatEnd = sheet.shots.slice(0, butSilenceIdx + 1).reduce((a, x) => a + dur(x), 0);
      silenceGaps.push({ start: beatEnd, end: beatEnd + 1.0 });
    }
  }
  
  let music: string | null = null;
  // Confession_loop: no music (rule 14)
  if (sheet.patternId === "confession_loop") {
    music = null;
  } else if (soundDesign?.music && soundDesign.music.type === "cue" && deps.generateMusic) {
    try {
      const musicCue = soundDesign.music;
      if (musicCue.type === "cue") {
        music = await withMeter(meter, () => deps.generateMusic!(musicCue.prompt, total));
      }
    } catch (e) {
      console.warn(`[audio] Music generation failed: ${(e as Error).message}`);
    }
  } else if (!soundDesign && sheet.bed?.trim() && deps.bed) {
    // Fallback: use old drone bed if no sound design
    music = await deps.bed(sheet.bed, total);
  }
  
  // Convert generated SFX to the format stitchShots expects
  const sfxCues: (import("@/lib/sfx").SfxCue | GeneratedSfxCue)[] = generatedSfx.length > 0 
    ? generatedSfx.map(g => ({ kind: "generated" as const, shot: g.shot, offset: g.offset, gain: g.gain, url: g.url }))
    : plan.sfx;
  
  let stitched = await deps.stitch(v.shots.map((r) => r.url!), { 
    voices, 
    sfx: sfxCues, 
    duck: plan.duck, 
    bedGain: plan.bedGain, 
    music, 
    shotSeconds: sheet.shots.map(dur), 
    width, 
    height,
    silenceGaps
  });
  
  // Burn chunked captions for pattern-aware sheets, but not over the end card
  if (sheet.patternId === "confession_loop" && deps.burnCaptions) {
    const endCardIndex = sheet.shots.findIndex((s) => s.engine === "remotion" && s.n === sheet.shots.length);
    const endCardStart = endCardIndex >= 0 ? stitched.starts[endCardIndex] : Infinity;
    const captionCues = buildChunkedCaptions(sheet, stitched.starts).filter((c) => c.start < endCardStart);
    if (captionCues.length > 0) {
      const captioned = await deps.burnCaptions(stitched.url, captionCues, width, height ?? Math.round(width * 16 / 9));
      stitched = { ...stitched, url: captioned };
    }
  }
  
  // Trim final to exact sheet length if it's slightly longer
  if (mode === "final" && stitched.duration > sheet.targetSec + 0.05) {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const ffmpegPath = (await import("ffmpeg-static")).default;
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const os = await import("node:os");
    const run = promisify(execFile);
    
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gtm-trim-"));
    try {
      const inFile = path.join(dir, "in.mp4");
      await fs.writeFile(inFile, Buffer.from(stitched.url.split(",")[1], "base64"));
      const outFile = path.join(dir, "out.mp4");
      await run(ffmpegPath || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", inFile, "-t", String(sheet.targetSec), "-c", "copy", "-y", outFile], { timeout: 60_000 });
      stitched = { ...stitched, url: `data:video/mp4;base64,${(await fs.readFile(outFile)).toString("base64")}`, duration: sheet.targetSec };
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
  
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
