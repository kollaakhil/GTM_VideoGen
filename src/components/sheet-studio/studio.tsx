"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Check, ChevronRight, Clapperboard, Film, Loader2, Plus, ScrollText, Sparkles, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ShotSheet } from "@/lib/shot-sheet";
import { editorInstructions } from "@/lib/sheet/editor";
import { STEPS, type SheetRun, type Step } from "@/lib/sheet/run-types";
import { call, getRun, secs, usd } from "./api";
import { SheetTable } from "./sheet-table";
import { RenderSteps } from "./render-steps";
import { PreflightBanner } from "./preflight-banner";

const LABEL: Record<Step, string> = { brand: "Brand & goal", brief: "Brief", sheet: "Shot sheet", previews: "Previews", final: "Final" };
const ICON: Record<Step, React.ComponentType<{ className?: string }>> = { brand: Sparkles, brief: ScrollText, sheet: Table2, previews: Clapperboard, final: Film };

function Inner() {
  const router = useRouter();
  const runId = useSearchParams().get("run");
  const [run, setRun] = useState<SheetRun | null>(null);
  const [view, setView] = useState<Step>("brand");
  const [msg, setMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState<ShotSheet | null>(null);
  const [runs, setRuns] = useState<{ id: string; brand: string; goal: string; step: Step; createdAt: string }[]>([]);

  useEffect(() => {
    fetch("/api/sheet").then((r) => r.json()).then((j) => setRuns(j.runs ?? [])).catch(() => {});
  }, [runId]);

  const load = useCallback(async () => {
    if (!runId) return setRun(null);
    const r = await getRun(runId);
    setRun(r);
    return r;
  }, [runId]);

  useEffect(() => {
    load().then((r) => r && setView(r.step));
  }, [load]);

  // Poll while a step runs; jump to the step it lands on.
  useEffect(() => {
    if (run?.status !== "working") return;
    const t = setInterval(async () => {
      const r = await load();
      if (r && r.status !== "working") {
        setView(r.step);
        setDraft(null);
      }
    }, 2000);
    return () => clearInterval(t);
  }, [run?.status, load]);

  const act = async (body: Record<string, unknown>) => {
    setMsg(null);
    const j = await call(body);
    if (j.error) return setMsg(j.error), null;
    if (j.run) {
      setRun(j.run);
      if (j.run.id !== runId) router.replace(`/studio?run=${j.run.id}`);
    }
    return j;
  };

  const reached = (s: Step) => !!run && STEPS.indexOf(s) <= STEPS.indexOf(run.step) + (run.step === "sheet" && run.gate?.pass ? 1 : 0);
  const busy = run?.status === "working";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b px-6 py-4">
        <h1 className="text-xl font-semibold tracking-tight">Studio</h1>
        <span className="text-sm text-muted-foreground">Brand → brief → shot sheet → previews → final</span>
        <div className="ml-auto flex items-center gap-2">
          {run && <CostMeter run={run} onCap={(capUsd) => act({ action: "set_cap", runId: run.id, capUsd })} />}
          <select className="h-8 max-w-56 rounded-lg border bg-transparent px-2 text-xs" value={runId ?? ""} onChange={(e) => router.push(e.target.value ? `/studio?run=${e.target.value}` : "/studio")}>
            <option value="">Recent runs…</option>
            {runs.map((r) => <option key={r.id} value={r.id}>{r.brand} · {LABEL[r.step]} · {new Date(r.createdAt).toLocaleString()}</option>)}
          </select>
          <Button size="sm" variant="outline" onClick={() => { router.push("/studio"); setRun(null); setView("brand"); }}><Plus /> New video</Button>
        </div>
      </header>

      <PreflightBanner />

      <nav className="flex gap-1 border-b px-6 py-2" data-testid="steps">
        {STEPS.map((s, i) => {
          const Icon = ICON[s];
          const done = run && STEPS.indexOf(s) < STEPS.indexOf(run.step);
          return (
            <button key={s} disabled={s !== "brand" && !reached(s)} onClick={() => setView(s)}
              className={cn("flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm disabled:opacity-40", view === s ? "bg-zinc-800 text-white" : "text-zinc-400 hover:bg-zinc-900")}>
              <span className="font-mono text-[10px] text-zinc-500">{i + 1}</span>
              {done ? <Check className="size-4 text-emerald-400" /> : <Icon className="size-4" />}
              {LABEL[s]}
              {i < STEPS.length - 1 && <ChevronRight className="size-3 text-zinc-600" />}
            </button>
          );
        })}
      </nav>

      {(busy || run?.error || msg) && (
        <div className={cn("mx-6 mt-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm", busy ? "border-sky-900 bg-sky-950/40 text-sky-200" : "border-red-900 bg-red-950/40 text-red-200")}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <AlertTriangle className="size-4" />}
          {busy ? run?.activity : msg ?? run?.error}
        </div>
      )}

      <main className="flex-1 space-y-4 p-6">
        {view === "brand" && <BrandStep run={run} busy={busy} onCreate={(b) => act({ action: "create", ...b })} />}
        {view === "brief" && run && <BriefStep run={run} busy={busy} onSave={(brief, facts) => act({ action: "edit_brief", runId: run.id, brief, facts })} onNext={() => act({ action: "sheet", runId: run.id })} />}
        {view === "sheet" && run?.sheet && (
          <SheetStep run={run} draft={draft ?? run.sheet} busy={busy} setDraft={setDraft}
            onSave={async () => { if (draft) { const j = await act({ action: "edit_sheet", runId: run.id, sheet: draft }); if (j) setDraft(null); } }}
            onRewrite={() => act({ action: "sheet", runId: run.id })} onNext={() => setView("previews")} />
        )}
        {(view === "previews" || view === "final") && run?.sheet && <RenderSteps run={run} view={view} busy={busy} act={act} />}
        {run && <Timings run={run} />}
      </main>
    </div>
  );
}

function CostMeter({ run, onCap }: { run: SheetRun; onCap: (n: number) => void }) {
  const [cap, setCap] = useState(String(run.cost.capUsd));
  const pct = Math.min(100, (run.cost.spentUsd / Math.max(0.01, run.cost.capUsd)) * 100);
  return (
    <div className="flex items-center gap-2 rounded-lg border px-2 py-1 text-xs" title={run.cost.entries.map((e) => `${e.stage}: ${e.what} ${usd(e.usd)}`).join("\n")} data-testid="cost-meter">
      <span className="text-zinc-400">Spent</span><span className="font-mono">{usd(run.cost.spentUsd)}</span>
      <div className="h-1.5 w-16 overflow-hidden rounded bg-zinc-800"><div className={cn("h-full", pct > 85 ? "bg-red-500" : "bg-emerald-500")} style={{ width: `${pct}%` }} /></div>
      <span className="text-zinc-400">cap $</span>
      <input className="w-12 rounded border bg-transparent px-1 font-mono" value={cap} onChange={(e) => setCap(e.target.value)} onBlur={() => Number(cap) >= 0 && Number(cap) !== run.cost.capUsd && onCap(Number(cap))} />
    </div>
  );
}

function L({ t, children }: { t: string; children: React.ReactNode }) {
  return <label className="block space-y-1 text-sm"><span className="text-zinc-400">{t}</span>{children}</label>;
}

type BrandForm = { brandUrl: string; brand: string; goal: string; offer: string; facts: string; inspirationUrl: string; targetSec: number; aspect: ShotSheet["aspect"]; audioMode: ShotSheet["audioMode"]; patternId: string; capUsd: number; photos: string[] };

function BrandStep({ run, busy, onCreate }: { run: SheetRun | null; busy: boolean; onCreate: (b: BrandForm) => void }) {
  const [f, setF] = useState<BrandForm>(() => run ? { ...run.input, offer: run.input.offer ?? "", inspirationUrl: run.input.inspirationUrl ?? "", patternId: run.input.patternId ?? "confession_loop", capUsd: run.cost.capUsd, photos: [] } :
    { brandUrl: "https://", brand: "", goal: "", offer: "", facts: "", inspirationUrl: "", targetSec: 20, aspect: "16:9", audioMode: "foley", patternId: "confession_loop", capUsd: 2, photos: [] });
  const set = (p: Partial<BrandForm>) => setF((x) => ({ ...x, ...p }));
  const addPhotos = async (files: FileList | null) => {
    const urls = await Promise.all([...(files ?? [])].slice(0, 4).map((file) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(file); })));
    set({ photos: [...f.photos, ...urls].slice(0, 4) });
  };
  return (
    <div className="grid max-w-5xl gap-4 md:grid-cols-2" data-testid="brand-step">
      <div className="space-y-3">
        <L t="Brand or product page"><Input name="brandUrl" value={f.brandUrl} onChange={(e) => set({ brandUrl: e.target.value })} /></L>
        <L t="Product name (as it should appear)"><Input name="brand" value={f.brand} onChange={(e) => set({ brand: e.target.value })} placeholder="e.g. Gemini 4 Neon" /></L>
        <L t="Goal"><Textarea name="goal" value={f.goal} onChange={(e) => set({ goal: e.target.value })} placeholder="What should this video make people do?" /></L>
        <L t="Offer (optional)"><Input value={f.offer} onChange={(e) => set({ offer: e.target.value })} /></L>
        <L t="Inspiration video link (optional) — its craft becomes the sheet's style rules"><Input name="inspirationUrl" value={f.inspirationUrl} onChange={(e) => set({ inspirationUrl: e.target.value })} placeholder="https://x.com/…" /></L>
      </div>
      <div className="space-y-3">
        <L t="Verified facts — the only claims the video may make"><Textarea name="facts" rows={8} value={f.facts} onChange={(e) => set({ facts: e.target.value })} placeholder={"- 1 million-token context window\n- Not verified, so don't use: \"3x faster\""} /></L>
        <div className="grid grid-cols-3 gap-3">
          <L t="Length (s)"><Input type="number" min={6} max={60} value={f.targetSec} onChange={(e) => set({ targetSec: Number(e.target.value) })} /></L>
          <L t="Aspect"><select className="h-8 w-full rounded-lg border bg-transparent px-2 text-sm" value={f.aspect} onChange={(e) => set({ aspect: e.target.value as BrandForm["aspect"] })}>{["16:9", "9:16", "1:1"].map((a) => <option key={a}>{a}</option>)}</select></L>
          <L t="Story Pattern"><select className="h-8 w-full rounded-lg border bg-transparent px-2 text-sm" value={f.patternId} onChange={(e) => set({ patternId: e.target.value })}>
            <option value="confession_loop">Confession loop (default)</option>
            <option value="classic">Classic</option>
          </select></L>
          <L t="Run cap ($)"><Input type="number" min={0} max={25} step={0.5} value={f.capUsd} onChange={(e) => set({ capUsd: Number(e.target.value) })} /></L>
        </div>
        <L t="Audio">
          <div className="flex gap-2">
            {(["foley", "vo"] as const).map((m) => (
              <button key={m} type="button" onClick={() => set({ audioMode: m })} className={cn("flex-1 rounded-lg border px-3 py-2 text-left text-xs", f.audioMode === m ? "border-zinc-400 bg-zinc-900" : "border-zinc-800")}>
                <div className="font-semibold">{m === "foley" ? "Foley-first" : "Voiceover"}</div>
                <div className="text-zinc-500">{m === "foley" ? "No VO: a sound on every action plus a drone or music bed" : "Spoken lines plus sound effects and music"}</div>
              </button>
            ))}
          </div>
        </L>
        <L t="Product photos (optional, up to 4)"><input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(e) => addPhotos(e.target.files)} className="text-xs" /></L>
        {f.photos.length > 0 && <div className="flex gap-2">{f.photos.map((p) => <img key={p.slice(-40)} src={p} alt="" className="size-14 rounded object-cover" />)}</div>}
        <Button disabled={busy || !/^https?:\/\/.+\..+/.test(f.brandUrl) || f.goal.trim().length < 3} onClick={() => onCreate(f)} data-testid="start">
          {run ? "Start a new run with these" : "Research & write the brief"} <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

function BriefStep({ run, busy, onSave, onNext }: { run: SheetRun; busy: boolean; onSave: (b: NonNullable<SheetRun["brief"]>, facts: string) => void; onNext: () => void }) {
  const [b, setB] = useState(run.brief);
  const [facts, setFacts] = useState(run.input.facts);
  useEffect(() => { setB(run.brief); setFacts(run.input.facts); }, [run.brief, run.input.facts]);
  if (!b) return <p className="text-sm text-zinc-400">The brief appears here when research finishes.</p>;
  const dirty = JSON.stringify(b) !== JSON.stringify(run.brief) || facts !== run.input.facts;
  const F = (k: "objective" | "audience" | "insight" | "offer" | "kpi", rows = 2) => (
    <label key={k} className="block space-y-1 text-sm"><span className="capitalize text-zinc-400">{k}</span><Textarea rows={rows} value={b[k]} onChange={(e) => setB({ ...b, [k]: e.target.value })} /></label>
  );
  return (
    <div className="grid max-w-5xl gap-4 md:grid-cols-2" data-testid="brief-step">
      <div className="space-y-3">
        {F("objective")}{F("audience")}{F("insight")}{F("offer")}{F("kpi", 1)}
        <label className="block space-y-1 text-sm"><span className="text-zinc-400">Mandatories (one per line)</span><Textarea value={b.mandatories.join("\n")} onChange={(e) => setB({ ...b, mandatories: e.target.value.split("\n").filter(Boolean) })} /></label>
      </div>
      <div className="space-y-3">
        <label className="block space-y-1 text-sm"><span className="text-zinc-400">Verified facts</span><Textarea rows={8} value={facts} onChange={(e) => setFacts(e.target.value)} /></label>
        <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer text-zinc-300">Style rules · {run.rules.length} <span className="text-zinc-500">({run.ruleSource})</span></summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-zinc-400">{run.rules.map((r) => <li key={r.id}>{r.text} {r.check && <span className="text-emerald-500">· checked</span>}</li>)}</ol>
        </details>
        <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer text-zinc-300">Research</summary>
          {run.research && <div className="mt-2 space-y-1 text-xs text-zinc-400"><p>{run.research.summary}</p><p><b>Audience:</b> {run.research.audience}</p><p><b>Tone:</b> {run.research.tone}</p><p><b>Value props:</b> {run.research.valueProps.join(" · ")}</p></div>}
        </details>
        <div className="flex gap-2">
          <Button variant="outline" disabled={!dirty || busy} onClick={() => onSave(b, facts)}>Save brief</Button>
          <Button disabled={busy || dirty} onClick={onNext} data-testid="write-sheet">Write script & shot sheet <ChevronRight /></Button>
        </div>
      </div>
    </div>
  );
}

function SheetStep({ run, draft, setDraft, busy, onSave, onRewrite, onNext }: { run: SheetRun; draft: ShotSheet; setDraft: (s: ShotSheet) => void; busy: boolean; onSave: () => void; onRewrite: () => void; onNext: () => void }) {
  const dirty = JSON.stringify(draft) !== JSON.stringify(run.sheet);
  const [fixingGaps, setFixingGaps] = useState(false);
  const [overriding, setOverriding] = useState(false);
  const [fixResult, setFixResult] = useState<{ changes: string[]; fixed: number; remaining: number; message?: string } | undefined>();
  const byShot = useMemo(() => {
    const m: Record<number, string[]> = {};
    for (const i of run.gate?.issues ?? []) if (i.shot && i.level === "error") (m[i.shot] ??= []).push(i.text);
    return m;
  }, [run.gate]);
  const errors = run.gate?.issues.filter((i) => i.level === "error") ?? [];
  const warns = run.gate?.issues.filter((i) => i.level === "warn") ?? [];
  
  // Check if we can override: no claim/safety issues
  const cannotOverride = errors.filter((i) => 
    i.text.includes("claims") || 
    i.text.includes("unverified") || 
    i.text.includes("facts mark as") ||
    i.text.includes("verified facts don't support")
  );
  const canOverride = errors.length > 0 && cannotOverride.length === 0;
  
  const hasActiveRender = run.versions.some((v) => v.status === "rendering" || v.status === "queued");
  const canProceed = run.gate?.pass || run.gateOverride;
  
  const handleFixGaps = async () => {
    setFixingGaps(true);
    setFixResult(undefined);
    try {
      const j = await call({ action: "fix_gaps", runId: run.id });
      if (j.error) {
        setFixResult(undefined);
      } else {
        const changes = Array.isArray(j.changes) ? j.changes as string[] : [];
        const fixed = typeof j.fixed === "number" ? j.fixed : 0;
        const remaining = typeof j.remaining === "number" ? j.remaining : 0;
        const message = typeof j.message === "string" ? j.message : undefined;
        setFixResult({ changes, fixed, remaining, message });
        // Reload the run to get the updated sheet and gate
        window.location.reload();
      }
    } catch (e) {
      console.error("Fix gaps failed:", e);
    } finally {
      setFixingGaps(false);
    }
  };
  
  const handleOverride = async () => {
    if (!confirm(`Override ${errors.length} blocking error(s) and continue anyway? This will allow rendering despite gate failures.`)) return;
    setOverriding(true);
    try {
      const j = await call({ action: "override_gate", runId: run.id });
      if (j.error) {
        alert(`Cannot override: ${j.error}`);
      } else {
        window.location.reload();
      }
    } catch (e) {
      console.error("Override failed:", e);
    } finally {
      setOverriding(false);
    }
  };
  
  return (
    <div className="space-y-4" data-testid="sheet-step">
      <div className="flex flex-wrap items-center gap-3">
        <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm", canProceed ? "border-emerald-900 bg-emerald-950/40 text-emerald-300" : "border-red-900 bg-red-950/40 text-red-300")} data-testid="gate">
          {canProceed ? <Check className="size-4" /> : <AlertTriangle className="size-4" />}
          Sheet check: {run.gate?.pass ? "passed" : run.gateOverride ? `overridden (${errors.length} issues)` : `${errors.length} blocking`}{warns.length > 0 && `, ${warns.length} style notes`}{dirty && " (save to re-check)"}
        </div>
        {!canProceed && errors.length > 0 && !dirty && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={fixingGaps || hasActiveRender}
              onClick={handleFixGaps}
              className="border-amber-700 text-amber-300 hover:bg-amber-950/40"
              title={hasActiveRender ? "Cannot fix gaps while a render is running" : "Let the LLM make minimal edits to satisfy gate rules"}
              data-testid="fix-gaps"
            >
              {fixingGaps ? <><Loader2 className="size-3 animate-spin" /> Fixing…</> : "Fix the gaps"}
            </Button>
            {canOverride && (
              <Button
                size="sm"
                variant="outline"
                disabled={overriding || hasActiveRender}
                onClick={handleOverride}
                className="border-orange-700 text-orange-300 hover:bg-orange-950/40"
                title="Override blocking errors and allow rendering anyway (claim/safety errors cannot be overridden)"
                data-testid="override-gate"
              >
                {overriding ? <><Loader2 className="size-3 animate-spin" /> Overriding…</> : "Continue anyway"}
              </Button>
            )}
          </>
        )}
        <span className="text-xs text-zinc-500">v{draft.version} · {draft.shots.length} shots · {draft.targetSec}s · {draft.aspect} · {draft.audioMode === "foley" ? "foley-first" : "voiceover"}</span>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" disabled={busy} onClick={onRewrite}>Rewrite sheet</Button>
          <Button variant="outline" disabled={!dirty || busy} onClick={onSave} data-testid="save-sheet">Save edits & re-check</Button>
          <Button disabled={busy || dirty || !canProceed} onClick={onNext}>Previews <ChevronRight /></Button>
        </div>
      </div>
      {fixResult && (
        <div className="rounded-lg border border-blue-900 bg-blue-950/40 p-3 text-sm text-blue-200">
          <p className="font-semibold">{fixResult.message || `Fixed ${fixResult.fixed} issue(s)${fixResult.remaining > 0 ? `, ${fixResult.remaining} remaining` : ""}`}</p>
          {fixResult.changes.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {fixResult.changes.map((c, i) => <li key={i}>• {c}</li>)}
            </ul>
          )}
        </div>
      )}
      {run.gateOverride && (
        <div className="rounded-lg border border-orange-900 bg-orange-950/40 p-3 text-sm text-orange-200">
          <p className="font-semibold">Gate overridden by {run.gateOverride.by} at {new Date(run.gateOverride.at).toLocaleString()}</p>
          <p className="mt-1 text-xs">Rendering is allowed despite {run.gateOverride.issues.length} blocking error(s).</p>
        </div>
      )}
      {run.script && <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer text-zinc-300">Script</summary><pre className="mt-2 whitespace-pre-wrap text-xs text-zinc-400">{run.script}</pre></details>}
      <SheetTable sheet={draft} onChange={setDraft} issues={byShot} />
      <div className="grid gap-3 md:grid-cols-3">
        <label className="space-y-1 text-sm"><span className="text-zinc-400">End card title</span><Input value={draft.endCard.title} onChange={(e) => setDraft({ ...draft, endCard: { ...draft.endCard, title: e.target.value } })} /></label>
        <label className="space-y-1 text-sm"><span className="text-zinc-400">End card line</span><Input value={draft.endCard.line} onChange={(e) => setDraft({ ...draft, endCard: { ...draft.endCard, line: e.target.value } })} /></label>
        <label className="space-y-1 text-sm"><span className="text-zinc-400">Bed (drone / music)</span><Input value={draft.bed} onChange={(e) => setDraft({ ...draft, bed: e.target.value })} /></label>
      </div>
      {errors.length > 0 && (
        <div className="rounded-lg border border-red-900 p-3 text-xs">
          <div className="mb-1 font-semibold text-red-300">Blocking errors ({errors.length})</div>
          {errors.filter((i) => !i.shot).map((i) => <div key={i.text} className="text-red-400">• {i.text}</div>)}
          {errors.some((i) => i.shot) && <div className="text-zinc-500">Shot-level problems are shown in red on their rows.</div>}
        </div>
      )}
      {warns.length > 0 && (
        <div className="rounded-lg border border-amber-900 p-3 text-xs">
          <div className="mb-1 font-semibold text-amber-300">Style notes ({warns.length})</div>
          {warns.filter((i) => !i.shot).map((i) => <div key={i.text} className="text-amber-400">• {i.text}</div>)}
          {warns.some((i) => i.shot) && <div className="text-zinc-500">Shot-level style notes are shown in amber.</div>}
        </div>
      )}
      <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer text-zinc-300">Editor instructions</summary><pre className="mt-2 overflow-x-auto whitespace-pre text-[11px] text-zinc-400" data-testid="editor-notes">{editorInstructions(draft)}</pre></details>
    </div>
  );
}

function Timings({ run }: { run: SheetRun }) {
  if (!run.timings.length) return null;
  return (
    <details className="rounded-lg border p-3 text-sm" data-testid="timings"><summary className="cursor-pointer text-zinc-300">Stage timings · {secs(run.timings.reduce((a, t) => a + t.ms, 0))} total</summary>
      <table className="mt-2 text-xs text-zinc-400"><tbody>{run.timings.map((t, i) => <tr key={i}><td className="pr-4">{t.stage}</td><td className="pr-4 font-mono">{secs(t.ms)}</td><td className="text-zinc-600">{new Date(t.at).toLocaleTimeString()}{t.note ? ` · ${t.note}` : ""}</td></tr>)}</tbody></table>
    </details>
  );
}

export function SheetStudio() {
  return <Suspense><Inner /></Suspense>;
}
