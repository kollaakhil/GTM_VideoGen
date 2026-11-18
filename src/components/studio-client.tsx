"use client";

import "@xyflow/react/dist/style.css";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ReactFlowProvider } from "@xyflow/react";
import { History, MessageSquare, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Brand, Creative, StudioRun } from "@/lib/types";
import type { Model, Modality, RunSummary, CreativeAction, Ctx, Pricing } from "./studio/types";
import { FlowCtx } from "./studio/context";
import { DEFAULT_PLAN } from "./studio/constants";
import { fullUrl, urlOk } from "./studio/utils";
import { HistoryPanel } from "./studio/history-panel";
import { Canvas } from "./studio/canvas";

function StudioInner({ models, defaults }: { models: Model[]; defaults: Record<Modality, string> }) {
  const router = useRouter();
  const params = useSearchParams();
  const runId = params.get("run");

  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [run, setRun] = useState<StudioRun | null>(null);
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [form, setForm] = useState({ brandUrl: "https://", referenceUrl: "", offer: "", saveKit: true, kits: [] as Brand[], goal: "", format: "static" as "static" | "video", sel: defaults, refs: [] as string[], plan: DEFAULT_PLAN });

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  };

  const fetchJSON = useCallback(async (url: string, init?: RequestInit) => {
    const res = await fetch(url, init);
    if (res.status === 401) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      throw new Error("Not signed in");
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
    return json;
  }, []);

  const [pricing, setPricing] = useState<Pricing>({ credits: null, prices: {} });
  const loadRuns = useCallback(() => fetchJSON("/api/studio").then((j) => setRuns(j.runs)).catch(() => {}), [fetchJSON]);
  const loadRun = useCallback(
    (id: string) =>
      fetchJSON(`/api/studio?runId=${encodeURIComponent(id)}`)
        .then((j) => {
          setRun(j.run);
          setCreatives(j.creatives);
        })
        .catch((e) => flash((e as Error).message)),
    [fetchJSON],
  );

  const loadKits = useCallback(
    () => fetchJSON("/api/brands").then((j) => setForm((f) => ({ ...f, kits: j.brands }))).catch(() => {}),
    [fetchJSON],
  );
  const loadPricing = useCallback(() => fetchJSON("/api/video-pricing").then((j) => setPricing({ credits: j.credits ?? null, prices: j.prices ?? {}, realSet: j.realSet, upscaler: j.upscaler })).catch(() => {}), [fetchJSON]);
  const runStatus = run?.status;
  useEffect(() => {
    if (runStatus !== "working") void loadPricing();
  }, [loadPricing, runStatus]);

  useEffect(() => {
    loadRuns();
    loadKits();
  }, [loadRuns, loadKits]);

  useEffect(() => {
    if (runId) loadRun(runId);
    else {
      setRun(null);
      setCreatives([]);
    }
    setEditing(false);
  }, [runId, loadRun]);

  const status = run?.status;
  const id = run?.id;
  useEffect(() => {
    if (status !== "working" || !id) return;
    const since = Date.now();
    setElapsed(0);
    const poll = setInterval(() => loadRun(id), 1500);
    const tick = setInterval(() => setElapsed(Math.round((Date.now() - since) / 1000)), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      loadRuns();
    };
  }, [status, id, loadRun, loadRuns]);

  const act = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      setSending(true);
      try {
        const j = await fetchJSON("/api/studio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
        setRun(j.run);
        if (action === "research") router.replace(`/studio?run=${j.run.id}`);
        return true;
      } catch (e) {
        flash((e as Error).message);
        return false;
      } finally {
        setSending(false);
      }
    },
    [fetchJSON, router],
  );

  const start = () => {
    if (form.saveKit && urlOk(form.brandUrl))
      void fetch("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: fullUrl(form.brandUrl), offer: form.offer.trim() || undefined, photos: form.refs.length ? form.refs : undefined }),
      }).then(loadKits);
    return startRun();
  };
  const startRun = () => act("research", { offer: form.offer.trim() || undefined, brandUrl: fullUrl(form.brandUrl), referenceUrl: fullUrl(form.referenceUrl), goal: form.goal.trim(), format: form.format, models: form.sel });

  const creativeAction = async (c: Creative, a: CreativeAction, ch?: "meta" | "google", reason?: string) => {
    try {
      const j = await fetchJSON("/api/creatives", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id, action: a, channel: ch, reason }) });
      setCreatives((xs) => xs.map((x) => (x.id === c.id ? j.creative : x)));
      if (a === "request_publish") flash(`“${c.title}” is waiting in the Inbox. It will be created as a paused ad.`);
    } catch (e) {
      flash((e as Error).message);
    }
  };

  const byDir = useMemo(() => {
    const m: Record<string, Creative> = {};
    for (const c of creatives) if (c.directionId) m[c.directionId] = c;
    return m;
  }, [creatives]);

  const ctx: Ctx = {
    run,
    byDir,
    sending,
    models,
    form: { ...form, set: (patch) => setForm((f) => ({ ...f, ...patch })) },
    pricing,
    start,
    act,
    creativeAction,
    editing,
    setEditing,
  };

  return (
    <FlowCtx.Provider value={ctx}>
      <div className="flex h-screen flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] px-5">
          <div className="text-sm font-semibold tracking-tight">Studio</div>
          <div className="h-4 w-px bg-white/10" />
          <div className="min-w-0 truncate text-[13px] text-zinc-400">{run ? run.goal : "New run"}</div>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-8" onClick={() => setShowHistory((v) => !v)}>
              <History /> History ({runs.length})
            </Button>
            {run && (
              <Button size="sm" variant="outline" className="h-8" onClick={() => setShowLog(!showLog)}>
                <MessageSquare /> Activity
              </Button>
            )}
            <Button size="sm" className="h-8" onClick={() => router.push("/studio")}>
              <Plus /> New run
            </Button>
          </div>
        </header>
        <div className="relative flex min-h-0 flex-1">
          <Canvas elapsed={elapsed} notice={notice} />
          {showHistory && (
            <HistoryPanel
              runs={runs}
              current={run?.id}
              onClose={() => setShowHistory(false)}
              onOpen={(id) => {
                setShowHistory(false);
                router.push(`/studio?run=${id}`);
              }}
            />
          )}
          {showLog && run && (
            <aside className="absolute bottom-24 right-4 top-4 z-20 flex w-80 flex-col rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3 text-[13px] font-semibold">
                Activity
                <button onClick={() => setShowLog(false)} className="text-zinc-500 hover:text-zinc-200" aria-label="Close activity">
                  <X className="size-4" />
                </button>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {run.events.map((e, i) => (
                  <div
                    key={i}
                    className={cn(
                      "whitespace-pre-wrap rounded-xl px-3 py-2 text-[12px] leading-relaxed",
                      e.role === "user" && "ml-6 bg-indigo-500/15 text-indigo-100",
                      e.role === "agent" && "mr-6 bg-white/[0.05] text-zinc-300",
                      e.role === "error" && "border border-red-500/30 bg-red-500/10 text-red-200",
                    )}
                  >
                    {e.text}
                    <div className="mt-1 text-[10px] text-zinc-500">{new Date(e.at).toLocaleTimeString()}</div>
                  </div>
                ))}
              </div>
            </aside>
          )}
        </div>
      </div>
    </FlowCtx.Provider>
  );
}

export function StudioClient(props: { models: Model[]; defaults: Record<Modality, string> }) {
  return (
    <Suspense>
      <ReactFlowProvider>
        <StudioInner {...props} />
      </ReactFlowProvider>
    </Suspense>
  );
}
