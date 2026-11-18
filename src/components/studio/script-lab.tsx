"use client";

import { useEffect, useState } from "react";
import { Clapperboard, Check, ChevronDown, Lightbulb, Pencil, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { approvedStoryboardLength, recommendedOpening, scriptProductionBlockers } from "@/lib/quality-policy";
import { rehearsalMetrics, rehearseScript } from "@/lib/script-rehearsal";
import { cn } from "@/lib/utils";
import type { AdScript, Direction, StudioRun } from "@/lib/types";
import { estimateCost } from "@/lib/video-categories";
import { SCRIPT_STYLES, SCRIPT_STYLE_IDS, isScriptStyle, styleLabel, type ScriptStyleId } from "@/lib/script-styles";
import type { BeatEdit, ScriptEditBody } from "./types";
import { WRITERS, JUDGES, hookLabels } from "./constants";
import { money, scoreTone, savedWriter, savedJudge, judgeOf } from "./utils";

function PhoneOverlay({ onScreen, vo, seconds }: { onScreen: string; vo: string; seconds: number }) {
  const m = rehearsalMetrics({ vo, onScreen });
  return (
    <div className="mx-auto flex aspect-[9/16] w-32 flex-col justify-end rounded-2xl border border-zinc-700 bg-zinc-950 px-2 pb-7 text-center" aria-label="9:16 overlay preview">
      <span className="mb-auto mt-3 text-[9px] uppercase text-zinc-500">Overlay only · {seconds}s</span>
      <span className={`break-words text-[10px] font-semibold ${m.fits ? "text-white" : "text-amber-300"}`}>
        {m.lines.length ? m.lines.map((line, i) => <span key={i} className="block">{line}</span>) : "No overlay"}
      </span>
    </div>
  );
}

function ReadThrough({ script }: { script: AdScript }) {
  const [selected, setSelected] = useState(0);
  const [started, setStarted] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const total = script.beats.reduce((sum, b) => sum + b.seconds, 0);
  useEffect(() => {
    if (started === null) return;
    const timer = window.setInterval(() => {
      const next = Math.min(total, (performance.now() - started) / 1000);
      setElapsed(next);
      if (next >= total) setStarted(null);
    }, 100);
    return () => window.clearInterval(timer);
  }, [started, total]);
  let end = 0;
  const playing = script.beats.findIndex((b) => { end += b.seconds; return elapsed < end; });
  const index = started !== null ? Math.max(0, playing) : selected;
  const beat = script.beats[index];
  if (!beat) return null;
  const m = rehearsalMetrics(beat);
  const issues = rehearseScript(script);
  return (
    <section className="space-y-2 rounded border border-white/10 p-2 text-[11px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>Phone rehearsal</strong>
        <Button size="sm" variant="secondary" onClick={() => {
          if (started !== null) { setSelected(index); setStarted(null); }
          else { setElapsed(0); setStarted(performance.now()); }
        }}>{started !== null ? "Stop" : "Timed read-aloud"}</Button>
      </div>
      <p className="text-zinc-400">Read the narration as each beat appears. On mute, judge the shot and overlay without reading the VO.</p>
      <div className="flex flex-wrap gap-1" aria-label="Preview beat">
        {script.beats.map((_, i) => <button type="button" className={`rounded px-2 py-1 ${i === index ? "bg-indigo-500/30" : "bg-white/5"}`} key={i} aria-pressed={i === index} onClick={() => { setSelected(i); setStarted(null); setElapsed(0); }}>{i + 1}</button>)}
      </div>
      <PhoneOverlay {...beat} />
      <p className="break-words text-zinc-300">{beat.visual}</p>
      <p className="break-words text-zinc-400">VO ({m.speakingSeconds}s est.): {beat.vo || "—"}</p>
      <progress className="h-1 w-full" value={elapsed} max={total} aria-label="Read-aloud progress" />
      {issues.map((issue) => <p key={issue} className="text-amber-200">{issue}</p>)}
    </section>
  );
}

function ApprovedStoryboard({ script, busy, needsPhoto, hasKeyframes, lengthSec, onBuild }: {
  script: AdScript;
  busy: boolean;
  needsPhoto: boolean;
  hasKeyframes: boolean;
  lengthSec: number;
  onBuild: (lengthSec: number) => void;
}) {
  const blockers = scriptProductionBlockers(script);
  return (
    <div className="space-y-1.5">
      <Button type="button" size="sm" className="w-full" disabled={busy || needsPhoto} onClick={() => onBuild(lengthSec)}>
        <Clapperboard /> {hasKeyframes ? "Rebuild" : "Build"} {lengthSec}s storyboard
      </Button>
      {needsPhoto && <p className="text-[11px] text-amber-200">Add a product photo in Video plan to build keyframes.</p>}
      <p className="text-[10px] text-zinc-400">Image keyframes ≈ {money(estimateCost("storyboard", { lengthSec, shots: script.beats.length }))} · no video</p>
      {blockers.length > 0 && (
        <details className="text-xs text-amber-200">
          <summary className="cursor-pointer">{blockers.length} script {blockers.length === 1 ? "fix" : "fixes"} before HD</summary>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {blockers.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

const SCORE_LABELS: Record<string, string> = { customerLanguage: "customer language", productEarly: "product early", inspirationMatch: "inspiration match" };

export function ScriptLab({ d, open, setOpen, edits, setEdits, busy, needsPhoto, lengthSec, research, brief, realOffer, quotes, refs, scriptStyle, onDraft, onWrite, onApprove, onRescore, onStoryboard }: {
  d: Direction;
  open: string | null;
  setOpen: (id: string | null) => void;
  edits: Record<string, BeatEdit[]>;
  setEdits: (e: Record<string, BeatEdit[]>) => void;
  busy: boolean;
  needsPhoto: boolean;
  lengthSec: number;
  research: StudioRun["research"];
  brief: StudioRun["brief"];
  realOffer?: string | null;
  quotes: { text: string; url: string }[];
  refs: string[];
  scriptStyle?: string | null;
  onDraft: (proof: { tension: string; claim: string; action: string; asset?: string; offer: string; cta: string; quoteIndex?: number }, writer: string, judge: string, style: ScriptStyleId) => void;
  onWrite: (hookId: string, writer: string, judge: string, style: ScriptStyleId) => void;
  onApprove: (sc: AdScript, edit?: ScriptEditBody) => Promise<boolean>;
  onRescore: (sc: AdScript, edit?: ScriptEditBody) => Promise<boolean>;
  onStoryboard: (lengthSec: number) => void;
}) {
  const ap = d.approvedScript;
  const storyboardLength = approvedStoryboardLength(d);
  const [writer, setWriter] = useState(savedWriter);
  const [style, setStyle] = useState<ScriptStyleId>(isScriptStyle(scriptStyle) ? scriptStyle : "auto");
  const [ctas, setCtas] = useState<Record<string, string>>({});
  const [judge, setJudge] = useState(savedJudge);
  const lab = d.hookLab;
  const facts = Array.from(new Set([...(research?.valueProps ?? []), ...(realOffer?.split("\n") ?? [])].map((s) => s.trim()).filter(Boolean)));
  const [tension, setTension] = useState(lab?.brief.tension ?? brief?.insight ?? "");
  const [claim, setClaim] = useState(lab?.brief.claim ?? facts[0] ?? "");
  const [action, setAction] = useState(lab?.brief.action ?? "");
  const [asset, setAsset] = useState(lab?.brief.asset ?? "");
  const [offer, setOffer] = useState(lab?.brief.offer ?? realOffer ?? brief?.offer ?? "");
  const [cta, setCta] = useState(lab?.brief.cta ?? "");
  const [quoteIndex, setQuoteIndex] = useState(() => quotes.findIndex((quote) => quote.text === lab?.brief.quote?.text && quote.url === lab?.brief.quote?.url));
  const [selected, setSelected] = useState<string | undefined>(lab?.selectedId);
  const [showOpenings, setShowOpenings] = useState(false);
  const opening = recommendedOpening(lab?.hooks ?? []);
  const chosen = lab?.hooks.find((h) => h.id === selected && h.review?.blockers.length === 0) ?? opening;
  const scripts = d.scripts ?? [];
  const drafts = ap && !scripts.some((s) => s.id === ap.id) ? [ap, ...scripts] : scripts;
  const hasDrafts = drafts.length > 0;
  const savedQuote = lab?.brief.quote?.text;
  const changed = !!lab && (tension.trim() !== lab.brief.tension || claim !== lab.brief.claim || action.trim() !== lab.brief.action || asset.trim() !== (lab.brief.asset ?? "") || offer.trim() !== lab.brief.offer || cta.trim() !== lab.brief.cta || quotes[quoteIndex]?.text !== savedQuote || lengthSec !== lab.lengthSec);
  const [proofOpen, setProofOpen] = useState(!lab?.hooks.length);
  const canUse = !changed && !!chosen;
  const field = "nowheel w-full rounded border border-white/10 bg-zinc-950 p-1.5 text-[11px] text-zinc-200";
  const pickWriter = (w: string) => {
    setWriter(w);
    localStorage.setItem("gtm.writer", w);
  };
  const pickJudge = (j: string) => {
    setJudge(j);
    localStorage.setItem("gtm.judge", j);
  };
  const grader = judgeOf(writer, judge);
  return (
    <div className="nodrag flex flex-col gap-1.5">
      <details className="text-[10px] text-zinc-400">
        <summary className="cursor-pointer">Writer and reviewer settings</summary>
        <div className="mt-1">
          <select className="rounded bg-zinc-900 text-zinc-300" value={writer} onChange={(e) => pickWriter(e.target.value)} disabled={busy} aria-label="Script writer">
            {Object.entries(WRITERS).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>{" "}
          writes,{" "}
          <select className="rounded bg-zinc-900 text-zinc-300" value={grader} onChange={(e) => pickJudge(e.target.value)} disabled={busy} aria-label="Script grader">
            {Object.entries(JUDGES).map(([id, label]) => (
              <option key={id} value={id} disabled={id === writer}>{label}</option>
            ))}
          </select>{" "}
          grades
        </div>
      </details>
      <details open={proofOpen} onToggle={(event) => setProofOpen(event.currentTarget.open)} className="rounded-md border border-white/10 p-2 text-[11px]">
        <summary className="cursor-pointer font-semibold">{lab?.hooks.length ? "Edit script brief" : "1. Confirm the script brief"}</summary>
        <fieldset disabled={busy} className="mt-2 space-y-1.5">
          <p className="text-zinc-400">Goal: {brief?.kpi || brief?.objective || "Not set"} · {lengthSec}s</p>
          <label className="block">Script style<select className={field} value={style} aria-label="Script style" onChange={(e) => setStyle(e.target.value as ScriptStyleId)}>
            {SCRIPT_STYLE_IDS.map((id) => <option key={id} value={id}>{SCRIPT_STYLES[id].label}</option>)}
          </select></label>
          {style !== "auto" && <p className="text-zinc-400">{SCRIPT_STYLES[style].structure}</p>}
          <label className="block">One buyer tension<textarea className={field} maxLength={400} rows={2} value={tension} onChange={(e) => setTension(e.target.value)} /></label>
          <label className="block">Claim from saved research<select className={field} value={claim} onChange={(e) => setClaim(e.target.value)}>
            <option value="">Select one supported claim</option>
            {facts.map((fact) => <option value={fact} key={fact}>{fact}</option>)}
          </select></label>
          <label className="block">Scene to show<textarea className={field} maxLength={500} rows={2} value={action} onChange={(e) => setAction(e.target.value)} placeholder="One visible action or result that supports the claim" /></label>
          <label className="block">Proof asset link (optional)<input className={field} value={asset.startsWith("data:") ? "" : asset} onChange={(e) => setAsset(e.target.value)} placeholder="Only add a specific reference if needed" /></label>
          {!!refs.length && <div className="flex flex-wrap gap-1">{refs.map((ref, i) => <button type="button" className="rounded border border-white/10 px-2 py-1" aria-pressed={asset === ref} key={i} onClick={() => setAsset(ref)}>Use photo {i + 1}</button>)}</div>}
          {asset && <div className="flex flex-wrap items-center gap-2 text-zinc-400">
            {asset.startsWith("data:") ? "Uploaded product photo selected" : asset.startsWith("https://") || asset.startsWith("/api/media/") ? <a className="underline" href={asset} target="_blank" rel="noreferrer">Review proof asset</a> : null}
            <button type="button" className="underline" onClick={() => setAsset("")}>Remove asset</button>
          </div>}
          <label className="block">Exact offer terms (one per line)<textarea className={field} rows={2} maxLength={400} value={offer} onChange={(e) => setOffer(e.target.value)} /></label>
          <label className="block">One exact CTA<input className={field} maxLength={40} value={cta} onChange={(e) => setCta(e.target.value)} placeholder="e.g. Help me choose" /></label>
          {quotes.length ? <label className="block">Optional sourced quote<select className={field} value={quoteIndex} onChange={(e) => setQuoteIndex(Number(e.target.value))}>
            <option value={-1}>No quote</option>
            {quotes.map((q, i) => <option key={i} value={i}>{q.text}</option>)}
          </select></label> : <p className="text-zinc-400">No verified buyer wording saved. Treat objections as hypotheses, not quotes.</p>}
          <p className="text-zinc-400">Drafting uses saved research. Storyboards reuse saved brand photos; no need to attach them here.</p>
          <Button size="sm" variant="secondary" className="w-full" disabled={!tension.trim() || !claim || !action.trim() || !cta.trim()} onClick={() => {
            onDraft({ tension, claim, action, ...(asset.trim() ? { asset } : {}), offer, cta, ...(quoteIndex >= 0 ? { quoteIndex } : {}) }, writer, grader, style);
          }}><Lightbulb /> {lab?.hooks.length ? "Draft new openings" : "Draft openings"}</Button>
        </fieldset>
      </details>
      {!!lab?.hooks.length && (
        <section className="space-y-1.5 rounded border border-white/10 p-2 text-[11px]">
          {hasDrafts && lab.selectedId && (
            <button type="button" className="text-zinc-400 underline" aria-expanded={showOpenings} onClick={() => setShowOpenings(!showOpenings)}>
              {showOpenings ? "Hide openings" : "Try a different opening"}
            </button>
          )}
          {(!hasDrafts || !lab.selectedId || showOpenings) && <>
            {chosen ? (
              <div>
                <h3 className="font-semibold">{chosen.id === opening?.id ? "Recommended opening" : "Selected opening"}</h3>
                <p className="text-zinc-300">“{chosen.spoken}”</p>
                <p className="text-zinc-400">{chosen.visual}</p>
              </div>
            ) : <p className="text-amber-200">No opening passed review. Edit the brief and draft again.</p>}
            {changed && <p className="text-amber-200">The brief or duration changed. Draft new openings to continue.</p>}
            <details className="space-y-1.5">
              <summary className="cursor-pointer text-zinc-400">{chosen ? "Compare openings" : "See why the openings were blocked"} ({lab.hooks.length})</summary>
              {lab.hooks.map((h) => (
                <div key={h.id} className="space-y-1 rounded border border-white/10 p-1.5">
                  <label className="flex items-center gap-2">
                    <input type="radio" name={`hook-${d.id}`} checked={chosen?.id === h.id} disabled={busy || changed || !h.review || !!h.review.blockers.length} onChange={() => setSelected(h.id)} />
                    <span>{hookLabels[h.type]}{opening?.id === h.id ? " · recommended" : ""}</span>
                    {h.review && <span className={`ml-auto rounded px-1 ${scoreTone(h.review.score)}`}>Opening: {h.review.score}/10</span>}
                  </label>
                  <p className="text-zinc-300">{h.visual}</p>
                  <p className="text-zinc-400">VO: “{h.spoken}”{h.onScreen ? ` · Overlay: “${h.onScreen}”` : ""}</p>
                  {h.review && <p className="text-zinc-400">{h.review.note}</p>}
                  {h.review?.blockers.map((blocker, i) => <p key={i} className="text-amber-200">{blocker}</p>)}
                  {chosen?.id === h.id && <PhoneOverlay vo={h.spoken} onScreen={h.onScreen} seconds={3} />}
                </div>
              ))}
            </details>
            {chosen && <Button size="sm" className="w-full" disabled={busy || !canUse} onClick={() => {
              setShowOpenings(false);
              onWrite(chosen.id, writer, grader, style);
            }}><Pencil /> Write script</Button>}
          </>}
        </section>
      )}
      {hasDrafts && (
        <div className="order-first space-y-2">
          <h3 className="text-xs font-medium text-zinc-400">Scripts</h3>
          {drafts.map((sc, index) => {
          const isOpen = open === sc.id;
          const lines = edits[sc.id];
          const ctaEdit = ctas[sc.id];
          const ctaEdited = ctaEdit !== undefined && ctaEdit.trim() !== "" && ctaEdit.trim() !== sc.cta;
          const edited = !!lines?.some((line, i) => line.vo.trim() !== sc.beats[i].vo || line.onScreen.trim() !== sc.beats[i].onScreen) || ctaEdited;
          const editBody: ScriptEditBody | undefined = edited ? { ...(lines ? { beats: lines } : {}), ...(ctaEdited ? { cta: ctaEdit.trim() } : {}) } : undefined;
          const clearEdit = () => {
            setEdits(Object.fromEntries(Object.entries(edits).filter(([id]) => id !== sc.id)));
            setCtas(Object.fromEntries(Object.entries(ctas).filter(([id]) => id !== sc.id)));
          };
          const updateBeat = (index: number, patch: Partial<BeatEdit>) => {
            const next = (lines ?? sc.beats).map(({ vo, onScreen }, i) => i === index ? { vo, onScreen, ...patch } : { vo, onScreen });
            setEdits({ ...edits, [sc.id]: next });
          };
          const sco = sc.score;
          const approved = ap?.id === sc.id;
          const savedDraft = d.scripts?.some((s) => s.id === sc.id);
          return (
            <div key={sc.id} className={cn("rounded-lg border bg-white/[0.02] p-2.5", approved ? "border-emerald-500/40" : "border-white/10")}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-zinc-200">Draft {index + 1}</span>
                <span aria-label={sco ? `Script score: ${sco.overall} out of 10` : "Not scored"} className="rounded bg-white/10 px-1.5 py-0.5 text-xs tabular-nums text-zinc-200">
                  {sco ? `${sco.overall}/10` : "Not scored"}
                </span>
              </div>
              <p className="my-2 text-xs leading-snug text-zinc-300">“{sc.hook.spoken}”</p>
              <div className="flex items-center justify-between gap-2">
                <button type="button" className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : sc.id)}>
                  {isOpen ? "Hide script" : savedDraft ? "View / edit" : "View script"}
                  <ChevronDown className={`size-3 shrink-0 transition ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {approved && !edited
                  ? <span className="flex items-center gap-1 text-xs font-medium text-emerald-300"><Check className="size-3.5" /> Approved</span>
                  : <span className="flex gap-1">
                      {savedDraft && <Button type="button" size="sm" variant="secondary" aria-label={`Re-score draft ${index + 1} for ${d.title}`} disabled={busy} title="Re-run the checks and the score with your edits, without approving" onClick={() => onRescore(sc, editBody).then((ok) => ok && clearEdit())}>
                        <RefreshCw /> Re-score
                      </Button>}
                      <Button type="button" size="sm" aria-label={`Approve draft ${index + 1} for ${d.title}`} disabled={busy} onClick={() => onApprove(sc, editBody).then((ok) => ok && clearEdit())}>
                        <Check /> Approve
                      </Button>
                    </span>}
              </div>
              {approved && ap && storyboardLength !== undefined && (
                <div className="mt-2">
                  <ApprovedStoryboard script={ap} busy={busy} needsPhoto={needsPhoto} hasKeyframes={!!d.shots?.length} lengthSec={storyboardLength} onBuild={onStoryboard} />
                </div>
              )}
              {isOpen && (
                <div className="mt-1.5 space-y-1.5">
                  {sc.beats.map((b, i) => (
                    <div key={i} className="space-y-0.5">
                      <div className="text-[10px] text-zinc-400">{i + 1}. {b.seconds}s · {b.visual}</div>
                      <textarea
                        aria-label={`Beat ${i + 1} voiceover`}
                        readOnly={!savedDraft}
                        placeholder="Spoken line"
                        maxLength={300}
                        className={field}
                        rows={2}
                        value={lines?.[i]?.vo ?? b.vo}
                        onChange={(e) => updateBeat(i, { vo: e.target.value })}
                      />
                      <input
                        aria-label={`Beat ${i + 1} on-screen copy`}
                        readOnly={!savedDraft}
                        placeholder="On-screen copy"
                        maxLength={160}
                        className={field}
                        value={lines?.[i]?.onScreen ?? b.onScreen}
                        onChange={(e) => updateBeat(i, { onScreen: e.target.value })}
                      />
                    </div>
                  ))}
                  <label className="block text-[10px] text-zinc-400">CTA (said and shown in the last beat)
                    <input aria-label="CTA" readOnly={!savedDraft} maxLength={60} className={field} value={ctaEdit ?? sc.cta} onChange={(e) => setCtas({ ...ctas, [sc.id]: e.target.value })} />
                  </label>
                  {sc.style && <div className="text-[10px] text-zinc-400">Style: {styleLabel(sc.style)}</div>}
                  {sco && (
                    <div className="flex flex-wrap gap-1">
                      <span className="text-[9px] text-zinc-400">Category scores:</span>
                      {Object.entries(sco.scores).map(([k, v]) => (
                        <span key={k} className={`rounded px-1 text-[9px] ${scoreTone(v)}`}>{SCORE_LABELS[k] ?? k} {v}</span>
                      ))}
                      {sco.scores.inspirationMatch === undefined && <span className="rounded bg-white/5 px-1 text-[9px] text-zinc-500" title="Add a reference URL or swipe-file ads, then re-score, to compare against inspirations. No penalty without them.">inspiration match skipped (no inspirations)</span>}
                    </div>
                  )}
                  {sc.gate && (
                    <p className="text-[10px] text-zinc-400" title={sc.gate.answers.map((a) => `${a.id}: yes ${a.yes.toFixed(2)} (conf ${a.confidence.toFixed(2)})`).join("\n")}>
                      Jev pre-check: {sc.gate.skippedJudge ? "passed, full judge skipped" : sc.gate.reasons[0] ?? "escalated to the full judge"} · {money(sc.gate.cost)}
                    </p>
                  )}
                  {[...(sc.claimFlags ?? []).map((f) => `Claim check, ${f.where}: ${f.claim}`), ...(sco?.unsupported ?? []).map((u) => `Unsupported: ${u}`), ...(sc.checks ?? []), ...(sco?.notes ?? [])].map((n, i) => (
                    <p key={i} className="text-[10px] text-amber-200/80">• {n}</p>
                  ))}
                  <ReadThrough script={{ ...sc, beats: sc.beats.map((b, i) => ({ ...b, ...lines?.[i] })) }} />
                  {edited && <p className="text-[10px] text-zinc-400">Re-score to check your edits (claims, timing, score) before approving. Approving also saves and re-checks them.</p>}
                </div>
              )}
            </div>
          );
          })}
        </div>
      )}
    </div>
  );
}
