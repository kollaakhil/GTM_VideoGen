"use client";

import { useState, useMemo } from "react";
import { Check, ChevronDown, Loader2, Play, Plus, Trophy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SheetRun } from "@/lib/sheet/run-types";
import type { VersionStack } from "@/lib/versions";
import { getPresetsWithCosts, createCustomStack, normalizeStack } from "@/lib/versions";
import { ModelPickerPanel, type Picks } from "@/components/model-picker";
import { STAGES } from "@/lib/registry";
import { usd, secs } from "./api";
import { useQueueStatus, GlobalQueueStrip, CancelButton } from "./queue-status";
import { estimateSheetVersion } from "@/lib/sheet/version-estimate";

interface VersionsPanelProps {
  run: SheetRun;
  busy: boolean;
  onStartVersions: (stacks: VersionStack[]) => Promise<void>;
  onPickWinner: (versionId: string) => Promise<void>;
}

export function VersionsPanel({ run, busy, onStartVersions, onPickWinner }: VersionsPanelProps) {
  const [selectedStacks, setSelectedStacks] = useState<VersionStack[]>([]);
  const [showCustom, setShowCustom] = useState(false);
  const [customPicks, setCustomPicks] = useState<Picks>({});
  const [customLabel, setCustomLabel] = useState("");
  const queueStatus = useQueueStatus(run.id);

  // Estimates come from this sheet (AI-video seconds at each stack's price + shot checks), the same number the server enforces.
  const sheetCost = (st: VersionStack) => (run.sheet ? estimateSheetVersion(run.sheet, st).usd : st.estimatedCostUsd);
  const presets = useMemo(
    () => getPresetsWithCosts({ shots: run.sheet?.shots.length, targetSec: run.sheet?.targetSec }).map((p) => ({ ...p, estimatedCostUsd: sheetCost(p) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run.sheet]
  );

  const totalCost = useMemo(
    () => selectedStacks.reduce((sum, s) => sum + sheetCost(s), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedStacks, run.sheet]
  );

  const overBudget = totalCost > run.cost.capUsd - run.cost.spentUsd;
  const canStart = selectedStacks.length >= 2 && selectedStacks.length <= 4 && !overBudget && !busy;

  const previews = run.versions.filter((v) => v.tier === "preview");
  const hasStarted = previews.length > 0;

  const toggleStack = (stack: VersionStack) => {
    setSelectedStacks((prev) => {
      const exists = prev.find((s) => s.id === stack.id);
      if (exists) {
        return prev.filter((s) => s.id !== stack.id);
      }
      if (prev.length >= 4) {
        return prev;
      }
      return [...prev, normalizeStack(stack)];
    });
  };

  const addCustomStack = () => {
    if (!customLabel.trim()) return;
    const stack = createCustomStack(customLabel, customPicks, {
      shots: run.sheet?.shots.length,
      targetSec: run.sheet?.targetSec,
    });
    toggleStack(stack);
    setShowCustom(false);
    setCustomLabel("");
    setCustomPicks({});
  };

  const handleStart = async () => {
    if (!canStart) return;
    await onStartVersions(selectedStacks);
  };

  return (
    <div className="space-y-6" data-testid="versions-panel">
      {!hasStarted ? (
        <>
          <div>
            <h3 className="mb-2 text-lg font-semibold">Select version stacks (2-4)</h3>
            <p className="text-sm text-zinc-400">
              Each stack uses different models. Compare them side-by-side to find the best approach.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {presets.map((preset) => {
              const selected = selectedStacks.some((s) => s.id === preset.id);
              const disabled = !selected && selectedStacks.length >= 4;
              return (
                <button
                  key={preset.id}
                  onClick={() => !disabled && toggleStack(preset)}
                  disabled={disabled}
                  data-testid={`preset-${preset.id}`}
                  className={cn(
                    "rounded-lg border p-4 text-left transition-colors",
                    selected
                      ? "border-indigo-500 bg-indigo-500/10"
                      : disabled
                      ? "cursor-not-allowed border-zinc-800 bg-zinc-900/50 opacity-50"
                      : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-900"
                  )}
                >
                  <div className="mb-2 flex items-start justify-between">
                    <div>
                      <div className="font-semibold text-zinc-100">{preset.label}</div>
                      <div className="mt-1 text-xs text-zinc-400">{preset.description}</div>
                    </div>
                    {selected && <Check className="size-5 text-indigo-400" />}
                  </div>
                  <div className="text-xs text-zinc-500">
                    Est. cost: <span className="font-mono">{usd(preset.estimatedCostUsd)}</span>
                  </div>
                </button>
              );
            })}
          </div>

          <div>
            {!showCustom ? (
              <Button variant="outline" size="sm" onClick={() => setShowCustom(true)} data-testid="add-custom">
                <Plus className="size-4" /> Add custom stack
              </Button>
            ) : (
              <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-zinc-100">Custom stack</h4>
                  <button onClick={() => setShowCustom(false)} className="text-zinc-500 hover:text-zinc-300">
                    <X className="size-4" />
                  </button>
                </div>
                <input
                  type="text"
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  placeholder="Stack name (e.g., Fast draft)"
                  className="h-8 w-full rounded-lg border border-zinc-700 bg-zinc-950/70 px-3 text-sm text-zinc-100 outline-none"
                  data-testid="custom-label"
                />
                <ModelPickerPanel picks={customPicks} onChange={setCustomPicks} />
                <Button
                  size="sm"
                  onClick={addCustomStack}
                  disabled={!customLabel.trim()}
                  data-testid="save-custom"
                >
                  Add to selection
                </Button>
              </div>
            )}
          </div>

          {selectedStacks.length > 0 && (
            <div className="space-y-3 rounded-lg border border-zinc-700 bg-zinc-900/30 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-zinc-100">
                    {selectedStacks.length} stack{selectedStacks.length > 1 ? "s" : ""} selected
                  </div>
                  <div className="mt-1 text-xs text-zinc-400">
                    Total estimated cost: <span className="font-mono">{usd(totalCost)}</span>
                  </div>
                </div>
                <Button onClick={handleStart} disabled={!canStart} data-testid="start-versions">
                  {busy ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Rendering...
                    </>
                  ) : (
                    <>
                      <Play className="size-4" /> Start renders
                    </>
                  )}
                </Button>
              </div>

              {selectedStacks.length < 2 && (
                <div className="text-xs text-amber-400">Select at least 2 stacks to compare</div>
              )}
              {overBudget && (
                <div className="text-xs text-red-400">
                  Total cost exceeds remaining budget ({usd(run.cost.capUsd - run.cost.spentUsd)} available)
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {selectedStacks.map((stack) => (
                  <button
                    key={stack.id}
                    onClick={() => toggleStack(stack)}
                    className="flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-800/50 px-2 py-1 text-xs hover:border-zinc-600"
                    data-testid={`selected-${stack.id}`}
                  >
                    <span>{stack.label}</span>
                    <X className="size-3" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div>
            <h3 className="mb-2 text-lg font-semibold">Version comparison</h3>
            <p className="text-sm text-zinc-400">Compare render quality, cost, and speed across stacks</p>
          </div>

          {queueStatus && queueStatus.jobs.length > 0 && (
            <GlobalQueueStrip runId={run.id} queueJobs={queueStatus.jobs} />
          )}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {previews.map((version) => {
              const isDone = version.status === "done";
              const isFailed = version.status === "failed" || version.status === "refused";
              return (
                <div
                  key={version.id}
                  className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4"
                  data-testid={`version-${version.id}`}
                >
                  <div className="mb-3 flex items-start justify-between">
                    <div className="flex-1">
                      <div className="font-semibold text-zinc-100">{version.stack.label}</div>
                      <div className="text-xs text-zinc-400">{version.stack.description}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                          version.status === "done"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : version.status === "rendering"
                            ? "bg-sky-500/20 text-sky-400"
                            : version.status === "failed" || version.status === "refused"
                            ? "bg-red-500/20 text-red-400"
                            : "bg-zinc-700/50 text-zinc-400"
                        )}
                      >
                        {version.status}
                      </span>
                      {(version.status === "rendering" || version.status === "queued") && (
                        <CancelButton
                          runId={run.id}
                          versionId={version.id}
                          label=""
                          onCancel={() => window.location.reload()}
                        />
                      )}
                    </div>
                  </div>

                  {version.videoUrl ? (
                    <video src={version.videoUrl} controls className="mb-3 w-full rounded" />
                  ) : (
                    <div className="mb-3 flex aspect-video items-center justify-center rounded bg-zinc-800">
                      {version.status === "rendering" && <Loader2 className="size-8 animate-spin text-zinc-600" />}
                      {isFailed && <span className="text-xs text-red-400">{version.error ?? "Failed"}</span>}
                    </div>
                  )}

                  <div className="mb-3 flex flex-wrap gap-3 text-xs text-zinc-400">
                    <span className="font-mono">{usd(version.usd)}{version.estimate ? ` (est. ${usd(version.estimate.usd)})` : ""}</span>
                    <span>{secs(version.ms)}</span>
                    {version.score != null && (
                      <span className="font-semibold text-emerald-400">Score: {version.score.toFixed(1)}/10</span>
                    )}
                  </div>

                  {version.stack.models && (
                    <details className="mb-3 text-xs">
                      <summary className="cursor-pointer text-zinc-500">Model stack</summary>
                      <div className="mt-2 space-y-1 text-zinc-600">
                        {Object.entries(version.stack.models)
                          .filter(([, id]) => id && id !== "auto")
                          .map(([stage, modelId]) => (
                            <div key={stage}>
                              <span className="text-zinc-500">{stage}:</span> {modelId}
                            </div>
                          ))}
                      </div>
                    </details>
                  )}

                  {run.picks?.video === version.id ? (
                    <div className="flex items-center justify-center gap-1 rounded border border-emerald-500/40 py-1.5 text-xs font-medium text-emerald-400" data-testid={`winner-${version.id}`}>
                      <Trophy className="size-4" /> Winner: Final renders this version
                    </div>
                  ) : isDone && (
                    <Button
                      size="sm"
                      onClick={() => onPickWinner(version.id)}
                      className="w-full"
                      data-testid={`pick-${version.id}`}
                    >
                      <Trophy className="size-4" /> Pick as winner
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
