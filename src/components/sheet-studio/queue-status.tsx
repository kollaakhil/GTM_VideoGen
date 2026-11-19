"use client";

import { useEffect, useState } from "react";
import { Loader2, X, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface QueueJob {
  id: string;
  runId: string;
  versionId: string;
  shotId: string;
  state: "waiting" | "running" | "done" | "cancelled" | "failed";
  priority: "high" | "normal";
  enqueuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  position: number | null;
  durationMs: number | null;
  waitMs: number;
  error: string | null;
}

interface QueueStatusResponse {
  jobs: QueueJob[];
  hasActive: boolean;
}

export function useQueueStatus(runId: string | null) {
  const [queue, setQueue] = useState<QueueStatusResponse | null>(null);

  useEffect(() => {
    if (!runId) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/studio/queue?runId=${runId}`);
        if (res.ok) {
          const data = await res.json();
          setQueue(data);
        }
      } catch {
        // Ignore fetch errors
      }
    };

    poll();

    // Poll every 2s while there are active jobs
    const interval = setInterval(() => {
      if (queue?.hasActive) {
        poll();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [runId, queue?.hasActive]);

  return queue;
}

export function ShotQueueState({ shotId, queueJobs }: { shotId: string; queueJobs: QueueJob[] }) {
  const job = queueJobs.find((j) => j.shotId === shotId);
  
  if (!job || job.state === "done") return null;

  if (job.state === "waiting") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-400">
        <Clock className="size-3" />
        waiting, #{job.position} in line
      </span>
    );
  }

  if (job.state === "running") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-sky-400">
        <Loader2 className="size-3 animate-spin" />
        rendering
      </span>
    );
  }

  if (job.state === "cancelled") {
    return <span className="text-xs text-zinc-500">cancelled</span>;
  }

  if (job.state === "failed") {
    return <span className="text-xs text-red-400">failed</span>;
  }

  return null;
}

export function GlobalQueueStrip({ runId, queueJobs }: { runId: string; queueJobs: QueueJob[] }) {
  const otherRunJobs = queueJobs.filter((j) => j.runId !== runId && (j.state === "waiting" || j.state === "running"));
  
  if (otherRunJobs.length === 0) return null;

  const runIds = [...new Set(otherRunJobs.map((j) => j.runId))];

  return (
    <div className="rounded-lg border border-amber-900 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
      <div className="flex items-center gap-2">
        <Clock className="size-4" />
        <span>
          {otherRunJobs.length} job{otherRunJobs.length > 1 ? "s" : ""} ahead from{" "}
          {runIds.length} other run{runIds.length > 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}

export function CancelButton({ 
  runId, 
  versionId, 
  label = "Cancel",
  onCancel 
}: { 
  runId: string; 
  versionId?: string; 
  label?: string;
  onCancel?: () => void;
}) {
  const [cancelling, setCancelling] = useState(false);

  const handleCancel = async () => {
    if (!confirm(`Cancel ${versionId ? "this version" : "all jobs for this run"}?`)) return;

    setCancelling(true);
    try {
      const res = await fetch("/api/studio/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cancel",
          runId,
          ...(versionId && { versionId }),
        }),
      });

      if (res.ok) {
        onCancel?.();
      }
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCancel}
      disabled={cancelling}
      className="text-red-400 hover:bg-red-950/40 hover:text-red-300"
    >
      {cancelling ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
      {label}
    </Button>
  );
}
