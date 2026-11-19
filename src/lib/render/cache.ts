import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/** Stable JSON: object keys sorted, undefined dropped, so the same inputs always hash the same. */
export function stable(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  return `{${Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
}

/** Input hash for a render or a judge call. Big media inputs are hashed first so keys stay small. */
export const inputHash = (...parts: unknown[]) => createHash("sha256").update(stable(parts)).digest("hex").slice(0, 24);

export interface CacheStore<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T): Promise<void>;
}

export function memoryCache<T>(): CacheStore<T> & { size: () => number } {
  const m = new Map<string, T>();
  return { get: async (k) => m.get(k), set: async (k, v) => void m.set(k, v), size: () => m.size };
}

/** One small JSON file per key (values are URLs or verdicts, never media bytes), so the cache survives restarts. */
export function fileCache<T>(dir: string): CacheStore<T> {
  const file = (k: string) => path.join(dir, `${k.replace(/[^a-z0-9_-]/gi, "")}.json`);
  return {
    async get(k) {
      try {
        return JSON.parse(await fs.readFile(file(k), "utf8")) as T;
      } catch {
        return undefined;
      }
    },
    async set(k, v) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file(k), JSON.stringify(v));
    },
  };
}

/** Returns the cached value for `key`, or runs `fn` once and stores it. Concurrent callers for one key share one run. */
const inflight = new WeakMap<object, Map<string, Promise<unknown>>>();
export async function cached<T>(store: CacheStore<T>, key: string, fn: () => Promise<T>, o: { skip?: (v: T) => boolean | Promise<boolean>; persist?: (v: T) => boolean } = {}): Promise<{ value: T; hit: boolean }> {
  const hit = await store.get(key);
  if (hit !== undefined && !(await o.skip?.(hit))) return { value: hit, hit: true };
  let pending = inflight.get(store);
  if (!pending) inflight.set(store, (pending = new Map()));
  const running = pending.get(key) as Promise<T> | undefined;
  if (running) return { value: await running, hit: true };
  const p = fn().then(async (v) => { if (o.persist?.(v) ?? true) await store.set(key, v); return v; }).finally(() => pending!.delete(key));
  pending.set(key, p);
  return { value: await p, hit: false };
}
