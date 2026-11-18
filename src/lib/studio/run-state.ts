import { after } from "next/server";
import { newId, put } from "@/lib/store";
import type { RunEvent, StudioRun } from "@/lib/types";
import type { Job } from "./actions/types";

export const now = () => new Date().toISOString();

export const say = (run: StudioRun, role: RunEvent["role"], text: string) => run.events.push({ at: now(), role, text });

// Jobs running in this server process. A run marked "working" whose job isn't here was cut off by a restart.
export const jobs: Map<string, AbortController> = ((globalThis as { __studioJobs?: Map<string, AbortController> }).__studioJobs ??= new Map());

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
  run.updatedAt = now();
  await put("studio_runs", run);

  after(async () => {
    try {
      await job.work();
      run.status = "idle";
    } catch (e) {
      run.status = "error";
      say(run, "error", `${job.activity.replace("…", "")} failed: ${(e as Error).message}`);
    } finally {
      // Persist before releasing the job so a poll never sees "working" with no live job (would be healed as orphaned).
      if (jobs.has(jobId)) {
        Object.assign(run, { activity: null, jobId: null, job: null, updatedAt: now() });
        await put("studio_runs", run);
      }
      jobs.delete(jobId);
    }
  });
}
