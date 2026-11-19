/** Per-stage timing for a run, stored on the run so the Studio UI can show where the time went. */
export interface StageTiming {
  stage: string;
  /** Shot id for per-shot work. */
  shotId?: string;
  startedAt: string;
  ms: number;
  status: "ok" | "failed" | "cached";
  attempts?: number;
  renderer?: string;
}

export interface TimingSummary {
  stage: string;
  count: number;
  /** Sum of every item's time. */
  totalMs: number;
  /** Wall-clock span from the first start to the last end (smaller than totalMs when items ran in parallel). */
  wallMs: number;
  cached: number;
  failed: number;
}

export function summarizeTimings(items: StageTiming[]): TimingSummary[] {
  const by = new Map<string, StageTiming[]>();
  for (const t of items) by.set(t.stage, [...(by.get(t.stage) ?? []), t]);
  return [...by].map(([stage, ts]) => {
    const starts = ts.map((t) => Date.parse(t.startedAt));
    const ends = ts.map((t, i) => starts[i] + t.ms);
    return {
      stage, count: ts.length, totalMs: ts.reduce((s, t) => s + t.ms, 0), wallMs: Math.max(...ends) - Math.min(...starts),
      cached: ts.filter((t) => t.status === "cached").length, failed: ts.filter((t) => t.status === "failed").length,
    };
  });
}

/** Records timings onto an array (the run's `timings`). `time` wraps an async step and always records, even on error. */
export function timer(sink: StageTiming[], clock: () => number = Date.now) {
  return {
    async time<T>(stage: string, fn: () => Promise<T>, meta: Partial<Pick<StageTiming, "shotId" | "renderer">> = {}): Promise<T> {
      const t0 = clock();
      let status: StageTiming["status"] = "ok";
      try {
        return await fn();
      } catch (e) {
        status = "failed";
        throw e;
      } finally {
        sink.push({ stage, startedAt: new Date(t0).toISOString(), ms: clock() - t0, status, ...meta });
      }
    },
    record(t: StageTiming) {
      sink.push(t);
    },
  };
}
