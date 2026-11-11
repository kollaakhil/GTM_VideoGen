"use client";

import { useState } from "react";
import { Check, Circle, Film, ImageIcon, Loader2, RefreshCw, Send, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CreativeCard } from "@/components/creative-card";
import { cn } from "@/lib/utils";
import type { ModelOption } from "@/lib/models";
import type { Creative, Stage, StudioRun } from "@/lib/types";

type Model = ModelOption & { ready: boolean };
type Log = { role: "user" | "agent" | "error"; text: string };

const STAGES: { id: Stage; label: string }[] = [
  { id: "research", label: "Research" },
  { id: "brief", label: "Brief" },
  { id: "directions", label: "Directions" },
  { id: "generate", label: "Generate" },
  { id: "qa", label: "QA" },
  { id: "publish", label: "Publish" },
];

export function StudioClient({ models, defaults }: { models: Model[]; defaults: Record<"text" | "vision" | "image" | "video", string> }) {
  const [brandUrl, setBrandUrl] = useState("https://");
  const [goal, setGoal] = useState("");
  const [format, setFormat] = useState<"static" | "video">("static");
  const [sel, setSel] = useState(defaults);
  const [refs, setRefs] = useState<string[]>([]);
  const [run, setRun] = useState<StudioRun | null>(null);
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<Log[]>([
    { role: "agent", text: "Give me a brand URL and a one-line goal. I'll research the brand, write a brief and pitch three distinct directions for you to approve." },
  ]);

  const stageIdx = run ? STAGES.findIndex((s) => s.id === run.stage) : 0;
  const push = (l: Log) => setLog((x) => [...x, l]);

  async function call(action: string, extra: Record<string, unknown>, label: string) {
    setBusy(action);
    try {
      const res = await fetch("/api/studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, models: sel, ...extra }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Request failed");
      setRun(json.run);
      if (json.creatives) setCreatives(json.creatives);
      if (json.errors?.length) push({ role: "error", text: json.errors.join("\n") });
      push({ role: "agent", text: label });
      return json;
    } catch (e) {
      push({ role: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function start() {
    push({ role: "user", text: `${brandUrl}\n${goal}` });
    setCreatives([]);
    await call("research", { brandUrl, goal }, "Research done. Review it on the right, then generate the brief.");
  }

  function onFiles(files: FileList | null) {
    if (!files) return;
    [...files].slice(0, 4).forEach((f) => {
      const r = new FileReader();
      r.onload = () => setRefs((x) => [...x, String(r.result)].slice(0, 4));
      r.readAsDataURL(f);
    });
  }

  async function creativeAction(c: Creative, action: "approve" | "reject" | "request_publish", channel?: "meta" | "google") {
    const res = await fetch("/api/creatives", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id, action, channel }) });
    const json = await res.json();
    if (!res.ok) return push({ role: "error", text: json.error });
    setCreatives((xs) => xs.map((x) => (x.id === c.id ? json.creative : x)));
    if (action === "request_publish") {
      push({ role: "agent", text: `Sent “${c.title}” to the Inbox for approval. It will be created as a PAUSED ad.` });
      setRun((r) => (r ? { ...r, stage: "publish" } : r));
    }
  }

  const pick = (modality: Model["modality"]) => models.filter((m) => m.modality === modality);

  return (
    <div className="flex min-h-0 flex-1">
      {/* Left: agent chat + inputs */}
      <section className="flex w-[380px] shrink-0 flex-col border-r">
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {log.map((l, i) => (
            <div
              key={i}
              className={cn(
                "whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                l.role === "user" && "ml-8 bg-indigo-500/15",
                l.role === "agent" && "mr-8 bg-muted",
                l.role === "error" && "border border-red-500/40 bg-red-500/10 text-red-300",
              )}
            >
              {l.text}
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Working on {busy}…
            </div>
          )}
        </div>
        <div className="space-y-2 border-t p-4">
          <Input value={brandUrl} onChange={(e) => setBrandUrl(e.target.value)} placeholder="https://yourbrand.com" />
          <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Goal, e.g. Drive trial sign-ups from US founders at < $40 CPA" rows={2} />
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border p-0.5">
              {(["static", "video"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={cn("flex items-center gap-1 rounded px-2 py-1 text-xs", format === f ? "bg-muted font-medium" : "text-muted-foreground")}
                >
                  {f === "static" ? <ImageIcon className="size-3" /> : <Film className="size-3" />} {f}
                </button>
              ))}
            </div>
            <label className="flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted">
              <Upload className="size-3" /> Product photos {refs.length > 0 && `(${refs.length})`}
              <input type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
            </label>
            <Button size="sm" className="ml-auto" disabled={!!busy || goal.length < 3 || !brandUrl.startsWith("http")} onClick={start}>
              <Send /> Start
            </Button>
          </div>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">Models</summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["text", "vision", "image", "video"] as const).map((k) => (
                <label key={k} className="space-y-1">
                  <span className="capitalize">{k}</span>
                  <select
                    className="w-full rounded-md border bg-background px-2 py-1 text-xs text-foreground"
                    value={sel[k]}
                    onChange={(e) => setSel({ ...sel, [k]: e.target.value })}
                  >
                    {pick(k).map((m) => (
                      <option key={m.id + m.label} value={m.id}>
                        {m.label}
                        {m.ready ? "" : " · key needed"}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </details>
        </div>
      </section>

      {/* Right: canvas */}
      <section className="min-w-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center gap-1 border-b bg-background/90 px-6 py-3 backdrop-blur">
          {STAGES.map((s, i) => (
            <div key={s.id} className="flex items-center gap-1">
              <div
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs",
                  run && i < stageIdx && "text-emerald-400",
                  run && i === stageIdx && "bg-indigo-500/15 font-medium text-indigo-300",
                  (!run || i > stageIdx) && "text-muted-foreground",
                )}
              >
                {run && i < stageIdx ? <Check className="size-3" /> : <Circle className="size-3" />}
                {s.label}
              </div>
              {i < STAGES.length - 1 && <div className="h-px w-4 bg-border" />}
            </div>
          ))}
          {run && <Badge variant="outline" className="ml-auto">Run cost ${run.costUsd.toFixed(3)}</Badge>}
        </div>

        {!run && (
          <div className="flex h-[70%] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
            <Sparkles className="size-8 text-indigo-400" />
            <div className="text-sm">Your research, brief, directions and creatives will appear here.</div>
          </div>
        )}

        {run && (
          <div className="space-y-6 p-6">
            {run.research && (
              <StepCard
                title="Research"
                done={stageIdx > 1}
                action={
                  stageIdx === 1 && (
                    <Button size="sm" disabled={!!busy} onClick={() => call("brief", { runId: run.id }, "Brief ready. Approve it to get three directions.")}>
                      Write brief
                    </Button>
                  )
                }
              >
                <p className="text-sm">{run.research.summary}</p>
                <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
                  <Field label="Audience">{run.research.audience}</Field>
                  <Field label="Tone">{run.research.tone}</Field>
                  <Field label="Value props">{run.research.valueProps.join(" · ")}</Field>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {run.research.angles.map((a) => (
                    <Badge key={a} variant="secondary">{a}</Badge>
                  ))}
                </div>
              </StepCard>
            )}

            {run.brief && (
              <StepCard
                title="Creative brief"
                done={stageIdx > 2}
                action={
                  stageIdx === 2 && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" disabled={!!busy} onClick={() => call("brief", { runId: run.id }, "Rewrote the brief.")}>
                        <RefreshCw /> Redo
                      </Button>
                      <Button size="sm" disabled={!!busy} onClick={() => call("directions", { runId: run.id, format }, "Here are three directions. Approve to generate.")}>
                        Approve & pitch directions
                      </Button>
                    </div>
                  )
                }
              >
                <div className="grid gap-3 text-sm md:grid-cols-2">
                  <Field label="Objective">{run.brief.objective}</Field>
                  <Field label="Audience">{run.brief.audience}</Field>
                  <Field label="Insight">{run.brief.insight}</Field>
                  <Field label="Offer">{run.brief.offer}</Field>
                  <Field label="Mandatories">{run.brief.mandatories.join(" · ")}</Field>
                  <Field label="KPI">{run.brief.kpi}</Field>
                </div>
              </StepCard>
            )}

            {run.directions.length > 0 && (
              <StepCard
                title="Three directions"
                done={stageIdx > 3}
                action={
                  stageIdx === 3 && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" disabled={!!busy} onClick={() => call("directions", { runId: run.id, format }, "New set of directions.")}>
                        <RefreshCw /> Re-pitch
                      </Button>
                      <Button size="sm" disabled={!!busy} onClick={() => call("generate", { runId: run.id, refs }, "Creatives generated and scored by the Vision QA gate.")}>
                        Generate creatives
                      </Button>
                    </div>
                  )
                }
              >
                <div className="grid gap-3 md:grid-cols-3">
                  {run.directions.map((d) => (
                    <div key={d.id} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium">{d.title}</div>
                        <Badge variant="outline">{d.angle}</Badge>
                      </div>
                      <div className="mt-2 text-base font-semibold leading-snug">“{d.hook}”</div>
                      <p className="mt-2 line-clamp-4 text-xs text-muted-foreground">{d.script}</p>
                    </div>
                  ))}
                </div>
              </StepCard>
            )}

            {creatives.length > 0 && (
              <StepCard title="Creatives · Vision QA gate (pass ≥ 8/10)" done={false}>
                <div className="grid gap-4 md:grid-cols-3">
                  {creatives.map((c) => (
                    <CreativeCard key={c.id} creative={c} onAction={(a, ch) => creativeAction(c, a, ch)} />
                  ))}
                </div>
              </StepCard>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function StepCard({ title, done, action, children }: { title: string; done: boolean; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-xl border bg-card p-5", done && "opacity-80")}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {done && <Check className="size-4 text-emerald-400" />}
          {title}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
