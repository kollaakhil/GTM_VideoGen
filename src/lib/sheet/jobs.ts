import fs from "node:fs";
import { after } from "next/server";
import { get, put } from "@/lib/store";
import type { CostEntry, SheetRun, Version } from "./run-types";

/** Background jobs for sheet runs: one at a time per run, in this server process. */
const live: Set<string> = ((globalThis as { __sheetJobs?: Set<string> }).__sheetJobs ??= new Set());

export const nowIso = () => new Date().toISOString();

/** Removes a run from the live job set (used by cancel to prevent stale job re-entry). */
export function deleteLive(runId: string) {
  live.delete(runId);
}

/** Appends every paid call to SPEND_LEDGER (a markdown table) when set, so the operator's ledger stays complete. */
export function ledger(run: SheetRun, e: CostEntry) {
  const file = process.env.SPEND_LEDGER;
  if (!file) return;
  try {
    const d = new Date(e.at);
    const p2 = (n: number) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
    fs.appendFileSync(file, `| ${stamp} | ${run.id} | ${e.stage}: ${e.what} (${e.model}) | $${e.usd.toFixed(4)} | $${(ledgerTotal(file) + e.usd).toFixed(4)} | app |\n`);
  } catch {}
}

/** Running total in the ledger's 5th column ("| when | run | what | $cost | $total | note |"), last row wins. */
export function ledgerTotal(file: string): number {
  let total = 0;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\|[^|]*\|[^|]*\|[^|]*\|\s*\$[\d.]+\s*\|\s*\$([\d.]+)\s*\|/);
    if (m) total = Number(m[1]);
  }
  return total;
}

/**
 * Minimal meter for the brief and sheet steps' text calls: refuses a call whose estimate would pass the run cap and
 * logs what it cost. (The render pipeline brings the full reserve/charge meter for paid renders.)
 */
export const meterFor = (run: SheetRun) => ({
  async run<T>(o: { stage: string; what: string; model: string; estimate: number }, fn: () => Promise<{ value: T; usd?: number }>): Promise<T> {
    if (run.cost.spentUsd + o.estimate > run.cost.capUsd + 1e-9) throw new Error(`Run cap reached: ${o.what} needs about $${o.estimate.toFixed(2)}; $${Math.max(0, run.cost.capUsd - run.cost.spentUsd).toFixed(2)} of the $${run.cost.capUsd.toFixed(2)} cap is left.`);
    const { value, usd } = await fn();
    const u = Number((usd ?? o.estimate).toFixed(4));
    if (u > 0) {
      const e: CostEntry = { at: nowIso(), stage: o.stage, what: o.what, model: o.model, usd: u, estimate: o.estimate };
      run.cost.spentUsd = Number((run.cost.spentUsd + u).toFixed(4));
      run.cost.entries.push(e);
      ledger(run, e);
    }
    return value;
  },
});

export async function healSheetRun(run: SheetRun) {
  if (run.status === "working" && !live.has(run.id)) {
    Object.assign(run, { status: "error", activity: null, error: "The server restarted mid-step. Run the step again." });
    await put("sheet_runs", run);
  }
  return run;
}

/** Times a stage and records it on the run (shown in Studio as stage timings). */
export async function timed<T>(run: SheetRun, stage: string, fn: () => Promise<T>, note?: string): Promise<T> {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    run.timings.push({ stage, ms: Date.now() - t0, at: nowIso(), ...(note ? { note } : {}) });
  }
}

export async function startSheetJob(run: SheetRun, activity: string, work: (run: SheetRun) => Promise<void>) {
  if (live.has(run.id)) throw new Error("This run is already working on a step.");
  live.add(run.id);
  Object.assign(run, { status: "working", activity, error: null, updatedAt: nowIso() });
  await put("sheet_runs", run);
  const go = async () => {
    try {
      await work(run);
      run.status = "idle";
    } catch (e) {
      run.status = "error";
      run.error = (e as Error).message;
      console.error(`[sheet] ${run.id} ${activity} failed`, e);
    } finally {
      run.activity = null;
      run.updatedAt = nowIso();
      await put("sheet_runs", run);
      live.delete(run.id);
    }
  };
  try {
    after(go);
  } catch {
    void go();
  }
}

export async function saveProgress(run: SheetRun) {
  const now = nowIso();
  const oldUpdatedAt = run.updatedAt;
  run.updatedAt = now;
  
  // Version check: reject stale writes from cancelled jobs
  // Load the current version and only save if we're newer or it's our own write
  const currentDoc = await get("sheet_runs", run.id);
  const current = currentDoc ? (currentDoc as SheetRun) : null;
  if (current && current.updatedAt > oldUpdatedAt) {
    // Another process has updated since we last read - this is a stale write
    // Merge critical fields (cost, versions status) but preserve newer edits (cap, override)
    console.warn(`[sheet] Stale save detected for ${run.id}: current ${current.updatedAt} > old ${oldUpdatedAt}. Merging.`);
    
    // Merge: keep their cap/override, add our cost entries and version updates
    run.cost.capUsd = current.cost.capUsd; // Preserve user's cap edits
    run.gateOverride = current.gateOverride; // Preserve user's override edits
    
    // Append our new cost entries to theirs
    const ourNewEntries = run.cost.entries.filter(e => e.at > oldUpdatedAt);
    run.cost.entries = [...current.cost.entries, ...ourNewEntries];
    
    // Merge version updates: keep the most recent status per version
    const versionMap = new Map<string, Version>(current.versions.map(v => [v.id, v] as [string, Version]));
    for (const v of run.versions) {
      const existing = versionMap.get(v.id);
      if (!existing || v.usd > existing.usd || v.status !== existing.status) {
        versionMap.set(v.id, v);
      }
    }
    run.versions = Array.from(versionMap.values());
  }
  
  await put("sheet_runs", run);
}

export const loadRun = (id: string) => get("sheet_runs", id);
