import type { SheetRun } from "@/lib/sheet/run-types";

export async function call(body: Record<string, unknown>): Promise<{ run?: SheetRun; error?: string; [k: string]: unknown }> {
  const r = await fetch("/api/sheet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) return { error: j.error ?? `HTTP ${r.status}` };
  return j;
}

export async function getRun(id: string): Promise<SheetRun | null> {
  const r = await fetch(`/api/sheet?id=${encodeURIComponent(id)}`);
  return r.ok ? (await r.json()).run : null;
}

export const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
export const secs = (ms: number) => (ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);
