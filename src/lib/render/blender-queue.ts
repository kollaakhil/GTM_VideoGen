import type { ChildProcess } from "node:child_process";

export type QueueJobState = "waiting" | "running" | "done" | "cancelled" | "failed";
export type QueuePriority = "high" | "normal";

export interface QueueJob {
  id: string;
  runId: string;
  versionId: string;
  shotId: string;
  state: QueueJobState;
  priority: QueuePriority;
  enqueuedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  process: ChildProcess | null;
  /** AbortController for cancellable AI calls */
  abortController: AbortController | null;
  error: string | null;
}

/**
 * Observable Blender render queue. Single slot with FIFO ordering (or priority).
 * Interactive jobs (from the Studio UI) get priority over background/scripted ones.
 */
export class BlenderQueue {
  private jobs: Map<string, QueueJob> = new Map();
  private runningJobId: string | null = null;
  private slot = 0;
  private readonly limit: number;
  private waiting: Array<{ id: string; resolve: () => void; reject: (err: Error) => void }> = [];

  constructor(limit = 1) {
    this.limit = Math.max(1, limit);
    this.slot = this.limit;
  }

  /** Enqueue a job and wait for the slot. Returns true if started, throws if cancelled. */
  async enqueue(job: Omit<QueueJob, "state" | "enqueuedAt" | "startedAt" | "finishedAt" | "process" | "abortController" | "error">): Promise<boolean> {
    const abortController = new AbortController();
    const fullJob: QueueJob = {
      ...job,
      state: "waiting",
      enqueuedAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      process: null,
      abortController,
      error: null,
    };
    this.jobs.set(job.id, fullJob);

    if (this.slot > 0) {
      this.slot--;
      this._startJob(job.id);
      return true;
    }

    // Wait in queue
    return new Promise<boolean>((resolve, reject) => {
      this.waiting.push({ id: job.id, resolve: () => resolve(true), reject });
    });
  }

  private _startJob(id: string): void {
    const job = this.jobs.get(id);
    if (!job || job.state === "cancelled") return;
    job.state = "running";
    job.startedAt = Date.now();
    this.runningJobId = id;
  }

  /** Register the spawned process handle for this job (for later cancellation) */
  setProcess(id: string, process: ChildProcess): void {
    const job = this.jobs.get(id);
    if (job) job.process = process;
  }

  /** Register an AbortController for cancellable AI calls */
  setAbortController(id: string, controller: AbortController): void {
    const job = this.jobs.get(id);
    if (job) job.abortController = controller;
  }

  /** Mark job as done and release the slot */
  finish(id: string, error?: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    
    job.state = error ? "failed" : "done";
    job.finishedAt = Date.now();
    job.error = error ?? null;
    
    if (this.runningJobId === id) {
      this.runningJobId = null;
      this._releaseSlot();
    }
  }

  private _releaseSlot(): void {
    if (this.waiting.length === 0) {
      this.slot++;
      return;
    }

    // Priority: high priority jobs go first, skip cancelled jobs
    const highPriorityIndex = this.waiting.findIndex((w) => {
      const job = this.jobs.get(w.id);
      return job?.priority === "high" && job.state === "waiting";
    });

    const nextIndex = highPriorityIndex >= 0 ? highPriorityIndex : this.waiting.findIndex((w) => {
      const job = this.jobs.get(w.id);
      return job && job.state === "waiting";
    });

    if (nextIndex < 0) {
      // Clean up any cancelled jobs from the waiting list
      this.waiting.forEach((w) => {
        const job = this.jobs.get(w.id);
        if (!job || job.state === "cancelled") {
          w.reject(new Error("Job was cancelled"));
        }
      });
      this.waiting = [];
      this.slot++;
      return;
    }

    const next = this.waiting.splice(nextIndex, 1)[0];
    const job = this.jobs.get(next.id);
    
    if (!job || job.state === "cancelled") {
      next.reject(new Error("Job was cancelled"));
      this._releaseSlot();
      return;
    }

    this._startJob(next.id);
    next.resolve();
  }

  /** Cancel a job: remove from queue if waiting, kill process if running */
  cancel(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;

    // Abort any in-flight AI video calls
    if (job.abortController && !job.abortController.signal.aborted) {
      job.abortController.abort();
    }

    if (job.state === "waiting") {
      job.state = "cancelled";
      job.finishedAt = Date.now();
      const idx = this.waiting.findIndex((w) => w.id === id);
      if (idx >= 0) {
        const waiter = this.waiting.splice(idx, 1)[0];
        waiter.reject(new Error("Job was cancelled"));
      }
    } else if (job.state === "running") {
      job.state = "cancelled";
      job.finishedAt = Date.now();
      
      // Kill the process
      if (job.process && !job.process.killed) {
        job.process.kill("SIGTERM");
        setTimeout(() => {
          if (job.process && !job.process.killed) {
            job.process.kill("SIGKILL");
          }
        }, 3000);
      }

      // Abort AI calls
      if (job.abortController) {
        job.abortController.abort();
      }

      if (this.runningJobId === id) {
        this.runningJobId = null;
        this._releaseSlot();
      }
    }
  }

  /** Cancel all jobs for a run */
  cancelRun(runId: string): void {
    const jobs = Array.from(this.jobs.values()).filter((j) => j.runId === runId && (j.state === "waiting" || j.state === "running"));
    
    // Mark all as cancelled and handle cleanup
    jobs.forEach((job) => {
      job.state = "cancelled";
      job.finishedAt = Date.now();
      
      // Kill process if running
      if (job.process && !job.process.killed) {
        job.process.kill("SIGTERM");
        setTimeout(() => {
          if (job.process && !job.process.killed) {
            job.process.kill("SIGKILL");
          }
        }, 3000);
      }
      
      // Abort AI calls
      if (job.abortController) {
        job.abortController.abort();
      }
      
      // Reject waiting promises
      const waitIdx = this.waiting.findIndex((w) => w.id === job.id);
      if (waitIdx >= 0) {
        const waiter = this.waiting.splice(waitIdx, 1)[0];
        waiter.reject(new Error("Job was cancelled"));
      }
    });
    
    // Release slot if a running job was cancelled
    const runningJob = jobs.find((j) => this.runningJobId === j.id);
    if (runningJob) {
      this.runningJobId = null;
      this._releaseSlot();
    }
  }

  /** Cancel all jobs for a version */
  cancelVersion(versionId: string): void {
    const jobs = Array.from(this.jobs.values()).filter((j) => j.versionId === versionId && (j.state === "waiting" || j.state === "running"));
    
    // Mark all as cancelled and handle cleanup
    jobs.forEach((job) => {
      job.state = "cancelled";
      job.finishedAt = Date.now();
      
      // Kill process if running
      if (job.process && !job.process.killed) {
        job.process.kill("SIGTERM");
        setTimeout(() => {
          if (job.process && !job.process.killed) {
            job.process.kill("SIGKILL");
          }
        }, 3000);
      }
      
      // Abort AI calls
      if (job.abortController) {
        job.abortController.abort();
      }
      
      // Reject waiting promises
      const waitIdx = this.waiting.findIndex((w) => w.id === job.id);
      if (waitIdx >= 0) {
        const waiter = this.waiting.splice(waitIdx, 1)[0];
        waiter.reject(new Error("Job was cancelled"));
      }
    });
    
    // Release slot if a running job was cancelled
    const runningJob = jobs.find((j) => this.runningJobId === j.id);
    if (runningJob) {
      this.runningJobId = null;
      this._releaseSlot();
    }
  }

  /** Auto-cancel: when a run starts a new render step, cancel that run's earlier queued jobs for the same version */
  autoCancel(runId: string, versionId: string, currentJobId: string): void {
    const ids = Array.from(this.jobs.values())
      .filter((j) => j.runId === runId && j.versionId === versionId && j.id !== currentJobId && j.state === "waiting")
      .map((j) => j.id);
    ids.forEach((id) => this.cancel(id));
  }

  /** Get all jobs (for API) */
  getAll(): QueueJob[] {
    return Array.from(this.jobs.values());
  }

  /** Get jobs for a specific run */
  getByRun(runId: string): QueueJob[] {
    return Array.from(this.jobs.values()).filter((j) => j.runId === runId);
  }

  /** Get jobs for a specific version */
  getByVersion(versionId: string): QueueJob[] {
    return Array.from(this.jobs.values()).filter((j) => j.versionId === versionId);
  }

  /** Get position in queue (1-indexed, null if not waiting) */
  getPosition(id: string): number | null {
    const job = this.jobs.get(id);
    if (!job || job.state !== "waiting") return null;

    const idx = this.waiting.findIndex((w) => w.id === id);
    if (idx < 0) return null;

    // Count only non-cancelled jobs ahead
    let position = 0;
    for (let i = 0; i < idx; i++) {
      const w = this.waiting[i];
      const j = this.jobs.get(w.id);
      if (j && j.state === "waiting") position++;
    }
    return position + 1;
  }

  /** Check if there are active jobs (running or waiting) */
  hasActive(): boolean {
    return Array.from(this.jobs.values()).some((j) => j.state === "waiting" || j.state === "running");
  }

  /** Cleanup old finished jobs (keep last hour) */
  cleanup(maxAgeMs = 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [id, job] of this.jobs) {
      if (job.finishedAt && job.finishedAt < cutoff) {
        this.jobs.delete(id);
      }
    }
  }

  /** Get the AbortSignal for a job (for passing to AI video calls) */
  getSignal(id: string): AbortSignal | undefined {
    return this.jobs.get(id)?.abortController?.signal;
  }
}

/** Global singleton queue */
export const blenderQueue = new BlenderQueue(Number(process.env.BLENDER_PARALLEL) || 1);
