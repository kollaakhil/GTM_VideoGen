import { after } from "next/server";
import { newId, put } from "@/lib/store";
import type { RunEvent, StudioRun } from "@/lib/types";
import { CostMeter, DEFAULT_CAP_USD, withMeter } from "@/lib/render/cost-meter";
import type { Job } from "./actions/types";

export const now = () => new Date().toISOString();

export const say = (run: StudioRun, role: RunEvent["role"], text: string) => run.events.push({ at: now(), role, text });

// Jobs running in this server process. A run marked "working" whose job isn't here was cut off by a restart.
export const jobs: Map<string, AbortController> = ((globalThis as { __studioJobs?: Map<string, AbortController> }).__studioJobs ??= new Map());

// Live spend meters of the jobs running in this process, by run id (so a raised cap reaches the job in flight).
export const meters: Map<string, CostMeter> = ((globalThis as { __studioMeters?: Map<string, CostMeter> }).__studioMeters ??= new Map());

export const live = (run: StudioRun) => !!run.jobId && jobs.has(run.jobId);

export async function healOrphan(run: StudioRun) {
  if (run.status !== "working" || live(run)) return run;
  stopProgress(run);
  Object.assign(run, { status: "error", activity: null, jobId: null, job: null, updatedAt: now() });
  say(run, "error", "This step was interrupted (the server restarted mid-step). Run it again.");
  await put("studio_runs", run);
  return run;
}

export function stopProgress(run: StudioRun) {
  for (const [k, v] of Object.entries(run.progress)) if (v !== "done" && v !== "failed") run.progress[k] = "failed";
}

export const saveRun = async (run: StudioRun) => {
  if (!live(run)) throw new Error("Stopped");
  await put("studio_runs", { ...run, updatedAt: now() });
};

/** Mark the run as working, respond, and run the job after the response. */
export async function startJob(run: StudioRun, job: Extract<Job, { work: unknown }>) {
  const jobId = newId("job");
  jobs.set(jobId, new AbortController());
  run.status = "working";
  run.activity = job.activity;
  run.jobId = jobId;
  run.failure = null;
  const directionId = typeof job.retry?.directionId === "string" ? job.retry.directionId : undefined;
  run.job = { label: job.activity, done: 0, total: 0, directionId, phase: "queued", startedAt: now() };
  run.updatedAt = now();
  // Per-run spend cap, enforced on the server before every paid call (src/lib/render/cost-meter.ts).
  const meter = new CostMeter({ capUsd: run.capUsd ?? DEFAULT_CAP_USD, spentUsd: run.costUsd, onChange: (snap) => { run.meter = snap; run.capUsd = snap.capUsd; } });
  meters.set(run.id, meter);
  run.meter = meter.snapshot();
  await put("studio_runs", run);

  after(async () => {
    try {
      await withMeter(meter, () => job.work());
      run.status = "idle";
    } catch (e) {
      run.status = "error";
      const message = (e as Error).message;
      console.error(`[studio] job ${jobId} on ${run.id} failed: ${job.activity}`, e);
      run.failure = { message, directionId: run.job?.directionId, retry: job.retry, at: now() };
      say(run, "error", `${job.activity.replace("…", "")} failed: ${message}`);
    } finally {
      // Persist before releasing the job so a poll never sees "working" with no live job (would be healed as orphaned).
      if (jobs.has(jobId)) {
        Object.assign(run, { activity: null, jobId: null, job: null, meter: meter.snapshot(), updatedAt: now() });
        await put("studio_runs", run);
      }
      jobs.delete(jobId);
      if (meters.get(run.id) === meter) meters.delete(run.id);
    }
  });
}
