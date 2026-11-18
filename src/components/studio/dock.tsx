"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useReactFlow } from "@xyflow/react";
import { AlertTriangle, ArrowRight, Square, Film, Loader2, Pencil, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { draftVideoBlocker, scriptProductionBlockers, storyboardKeyframeFixes, storyboardProofPhoto, storyboardTargets } from "@/lib/quality-policy";
import { useFlow } from "./context";
import { storyboardPhotos } from "./utils";

export function Dock({ elapsed, notice }: { elapsed: number; notice: string | null }) {
  const { run, act, sending, form, setEditing } = useFlow();
  const router = useRouter();
  const flow = useReactFlow();
  if (!run) return null;

  const lastError = run.status === "error" ? [...run.events].reverse().find((e) => e.role === "error")?.text : null;
  const btn = (label: string, onClick: () => void, primary = false, icon?: React.ReactNode) => (
    <Button
      key={label}
      size="sm"
      variant={primary ? "default" : "ghost"}
      disabled={sending}
      onClick={onClick}
      className={primary ? "bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white hover:opacity-90" : "text-zinc-300"}
    >
      {icon}
      {label}
      {primary && <ArrowRight />}
    </Button>
  );

  let text: React.ReactNode = null;
  let buttons: React.ReactNode[] = [];
  if (run.status === "working") {
    const total = run.directions.length;
    const done = run.directions.filter((d) => run.progress[d.id] === "done" || run.progress[d.id] === "failed").length;
    text = (
      <span className="flex items-center gap-2">
        <Loader2 className="size-4 animate-spin text-indigo-300" />
        {run.job?.label ?? run.activity}
        {run.stage === "generate" && total > 0 && <span className="text-zinc-500">{done}/{total}</span>}
        {run.job && (
          <span className="flex w-44 items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <span className="block h-full rounded-full bg-gradient-to-r from-indigo-400 to-fuchsia-400 transition-all duration-700" style={{ width: `${Math.max(5, run.job.total ? Math.round((run.job.done / run.job.total) * 100) : 5)}%` }} />
            </span>
            <span className="tabular-nums text-zinc-500">{run.job.total ? `${run.job.done}/${run.job.total}` : ""}</span>
          </span>
        )}
        <span className="tabular-nums text-zinc-500">{elapsed}s</span>
      </span>
    );
    buttons = [btn("Stop", () => act("cancel", { runId: run.id }), false, <Square className="fill-current" />)];
  } else {
    switch (run.stage) {
      case "research":
        text = "Research didn't finish.";
        buttons = [
          btn("Start over", () => router.push("/studio"), false),
          btn("Retry research", () => act("research", { brandUrl: run.brandUrl, goal: run.goal, format: run.format, referenceUrl: run.referenceUrl ?? "", offer: run.offer ?? undefined, models: run.models, autoBrief: run.autoBrief }), true),
        ];
        break;
      case "brief":
        text = "Research is ready. Review it, then write the brief.";
        buttons = [btn("Write the brief", () => act("brief", { runId: run.id }), true)];
        break;
      case "directions":
        if (run.concepts?.length) {
          text = "Pick the most distinct concepts on the Concept matrix, then turn them into directions.";
          buttons = [
            btn("Rebuild concepts", () => act("concepts", { runId: run.id, format: run.format }), false, <RefreshCw />),
            btn("Turn into directions", () => act("directions", { runId: run.id, format: run.format }), true),
          ];
          break;
        }
        text = run.autoBrief
          ? "Checkpoint 1: review the research, inspirations and brief. Edit anything, then approve to build concepts."
          : "Approve the brief to build a concept matrix: buyers × angles × formats, checked for diversity.";
        buttons = [
          btn("Edit", () => setEditing(true), false, <Pencil />),
          btn("Rewrite", () => act("brief", { runId: run.id }), false, <RefreshCw />),
          btn("Skip to directions", () => act("directions", { runId: run.id, format: run.format }), false),
          btn("Approve brief", () => act("concepts", { runId: run.id, format: run.format }), true),
        ];
        break;
      case "generate":
        if (run.format === "video") {
          const storyboards = run.directions.flatMap((d, index) => d.shots?.length ? [{
            index, blocked: !!draftVideoBlocker(d, run.videoPlan), fixes: scriptProductionBlockers(d.approvedScript).length + storyboardKeyframeFixes(d.shots).length,
          }] : []).sort((a, b) => Number(a.blocked) - Number(b.blocked) || a.fixes - b.fixes);
          const first = storyboards[0];
          if (first) {
            text = first.blocked ? "Open video controls to see what’s missing for a draft." : "Your storyboard is ready for a 480p draft.";
            buttons = [btn("Video controls", () => {
              const node = flow.getNode(`dir-${first.index}`);
              if (node) void flow.setCenter(node.position.x + (node.measured?.width ?? 340) / 2, node.position.y + 180, { zoom: 1, duration: 450 });
            }, true, <Film />)];
            break;
          }
          const approved = storyboardTargets(run.directions);
          if (!approved.length) {
            const written = run.directions.some((d) => d.scripts?.length);
            text = written ? "Click Approve on the draft you want to use." : "Open a concept to draft its script.";
            break;
          }
          const eligible = storyboardTargets(approved, form.plan.lengthSec);
          const photos = storyboardPhotos(run, form);
          const needsPhoto = !photos.count && approved.some((d) => !storyboardProofPhoto(run.id, d));
          const canBatch = eligible.length > 0 && (photos.count > 0 || eligible.every((d) => storyboardProofPhoto(run.id, d)));
          text = needsPhoto ? "Add product photos in Video plan before building keyframes." : "Build the storyboard from an approved direction. It uses the approved script’s duration.";
          buttons = [
            btn("Re-pitch", () => act("directions", { runId: run.id, format: run.format }), false, <RefreshCw />),
            ...(canBatch ? [btn("Build storyboards", () => act("storyboard", { runId: run.id, plan: form.plan, refs: photos.refs }), true)] : []),
          ];
          break;
        }
        text = "Happy with the directions? Generate images and run Vision QA.";
        buttons = [
          btn("Re-pitch", () => act("directions", { runId: run.id, format: run.format }), false, <RefreshCw />),
          btn("Generate creatives", () => act("generate", { runId: run.id, refs: form.refs }), true),
        ];
        break;
      default:
        text = "Send passing creatives to the Inbox, or redo the ones below the QA bar.";
        buttons = [
          ...(run.format === "video" ? [] : [btn("Regenerate all", () => act("generate", { runId: run.id, refs: form.refs }), false, <RefreshCw />)]),
          btn("New run", () => router.push("/studio"), false, <Plus />),
        ];
    }
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center px-6">
      <div className="pointer-events-auto flex max-w-3xl items-center gap-4 rounded-2xl border border-white/10 bg-zinc-900/90 py-2 pl-4 pr-2 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.9)] backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4 duration-300">
        <div className="min-w-0 text-[13px] text-zinc-200">
          {notice ? <span className="text-emerald-300">{notice}</span> : lastError ? (
            <span className="flex items-start gap-2 text-red-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span className="line-clamp-4">{lastError}</span>
              {/Higgsfield (?:sign-in|isn't connected)/.test(lastError) && (
                <Link href="/connections" className="shrink-0 font-medium underline">Connections</Link>
              )}
            </span>
          ) : (
            text
          )}
        </div>
        {buttons.length > 0 && <div className="flex shrink-0 items-center gap-1">{buttons}</div>}
        <div className="shrink-0 border-l border-white/10 pl-3 pr-1 text-[11px] tabular-nums text-zinc-500">${run.costUsd.toFixed(2)}</div>
      </div>
    </div>
  );
}
