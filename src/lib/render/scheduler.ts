import type { StageTiming } from "./timing";
import { cached, type CacheStore } from "./cache";

export interface RenderJob<T> {
  id: string;
  /** Input hash: an unchanged key is served from the cache with no render. */
  key: string;
  run: (attempt: number) => Promise<T>;
  stage?: string;
  renderer?: string;
}

export interface JobResult<T> {
  id: string;
  status: "ok" | "cached" | "failed";
  value?: T;
  error?: Error;
  attempts: number;
  ms: number;
}

/** Errors that a second try cannot fix (and might pay for twice): budget, missing tools, stop requests. */
export const isFatal = (e: unknown) => /^(BudgetExceeded|RendererUnavailable|AbortError)$/.test((e as Error)?.name ?? "") || /^(Stopped|Budget cap reached)\b/.test((e as Error)?.message ?? "");

export interface ScheduleOptions<T> {
  /** Parallel renders at once. Default 4. */
  limit?: number;
  /** Extra attempts after the first failure. Default 1. */
  retries?: number;
  cache?: CacheStore<T>;
  /** Do not trust a cached value (e.g. its file vanished). */
  stale?: (v: T) => boolean | Promise<boolean>;
  /** Cache only values this accepts (e.g. not inline data URLs). */
  persist?: (v: T) => boolean;
  timings?: StageTiming[];
  clock?: () => number;
  onDone?: (r: JobResult<T>) => void;
}

/**
 * Runs jobs with at most `limit` in flight. Failure isolation: a job that fails (after its retry) is reported and the
 * others carry on; this never throws for a job error. Results come back in job order.
 */
export async function runParallel<T>(jobs: RenderJob<T>[], o: ScheduleOptions<T> = {}): Promise<JobResult<T>[]> {
  const limit = Math.max(1, o.limit ?? 4);
  const retries = Math.max(0, o.retries ?? 1);
  const clock = o.clock ?? Date.now;
  const out: JobResult<T>[] = new Array(jobs.length);
  let next = 0;
  const one = async (i: number) => {
    const j = jobs[i];
    const t0 = clock();
    let attempts = 0;
    const attempt = async () => {
      let last: Error = new Error("not run");
      for (let a = 0; a <= retries; a++) {
        attempts++;
        try {
          return await j.run(a);
        } catch (e) {
          last = e instanceof Error ? e : new Error(String(e));
          if (isFatal(last)) break;
        }
      }
      throw last;
    };
    let r: JobResult<T>;
    try {
      const got = o.cache ? await cached(o.cache, j.key, attempt, { skip: o.stale, persist: o.persist }) : { value: await attempt(), hit: false };
      r = { id: j.id, status: got.hit ? "cached" : "ok", value: got.value, attempts, ms: clock() - t0 };
    } catch (e) {
      r = { id: j.id, status: "failed", error: e instanceof Error ? e : new Error(String(e)), attempts, ms: clock() - t0 };
    }
    out[i] = r;
    o.timings?.push({ stage: j.stage ?? "render", shotId: j.id, startedAt: new Date(t0).toISOString(), ms: r.ms, status: r.status, attempts: r.attempts, renderer: j.renderer });
    o.onDone?.(r);
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (next < jobs.length) await one(next++);
  }));
  return out;
}
