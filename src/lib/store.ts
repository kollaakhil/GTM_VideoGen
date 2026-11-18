import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { seed } from "./seed";
import type { Campaign, Creative, InboxItem, MetricDay, SignalEvent, StudioRun, Brand, PromptEntry, Swipe, Integration, JudgeCalibration } from "./types";

export interface Tables {
  brands: Brand;
  studio_runs: StudioRun;
  creatives: Creative;
  inbox_items: InboxItem;
  campaigns: Campaign;
  signal_events: SignalEvent;
  prompt_library: PromptEntry;
  swipes: Swipe;
  integrations: Integration;
  judge_calibrations: JudgeCalibration;
}
export type TableName = keyof Tables;

const g = globalThis as unknown as { __gtmMem?: Mem; __gtmPool?: pg.Pool; __gtmSb?: SupabaseClient };

/** Postgres (Supabase) for app data when DATABASE_URL is set; tables live in the private `gtm` schema. */
function db(): pg.Pool | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  g.__gtmPool ??= new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: process.env.VERCEL ? 2 : 5, idleTimeoutMillis: 10_000 });
  return g.__gtmPool;
}

/** Supabase Storage (private bucket) for media when the service-role key is set. */
function storage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  g.__gtmSb ??= createClient(url, key, { auth: { persistSession: false } });
  return g.__gtmSb.storage.from(BUCKET);
}
const BUCKET = "gtm-media";

type Mem = { [K in TableName]: Map<string, Tables[K]> } & { metrics: MetricDay[] };
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const TABLES: TableName[] = ["brands", "studio_runs", "creatives", "inbox_items", "campaigns", "signal_events", "prompt_library", "swipes", "integrations", "judge_calibrations"];
// Serverless filesystems are read-only/ephemeral: there the local store is memory-only and Supabase is required.
const canPersist = !process.env.VERCEL;

function mem(): Mem {
  if (g.__gtmMem) return g.__gtmMem;
  if (canPersist && fs.existsSync(DB_FILE)) {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, "utf8")) as Record<string, unknown[]> & { metrics: MetricDay[] };
    const m = { metrics: raw.metrics ?? [] } as Mem;
    for (const t of TABLES) (m as Record<string, unknown>)[t] = new Map((raw[t] ?? []).map((r) => [(r as { id: string }).id, r]));
    g.__gtmMem = m;
  } else {
    const s = seed();
    g.__gtmMem = {
      brands: new Map(),
      studio_runs: new Map(),
      creatives: new Map(s.creatives.map((c) => [c.id, c])),
      inbox_items: new Map(s.inbox.map((i) => [i.id, i])),
      campaigns: new Map(s.campaigns.map((c) => [c.id, c])),
      signal_events: new Map(s.signals.map((e) => [e.id, e])),
      prompt_library: new Map(),
      swipes: new Map(),
      integrations: new Map(),
      judge_calibrations: new Map(),
      metrics: s.metrics,
    };
    persist();
  }
  return g.__gtmMem!;
}

function persist() {
  if (!canPersist || !g.__gtmMem) return;
  const m = g.__gtmMem;
  const out: Record<string, unknown> = { metrics: m.metrics };
  for (const t of TABLES) out[t] = [...m[t].values()];
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(out));
  fs.renameSync(tmp, DB_FILE);
}

function mediaPath(rel: string) {
  const root = path.join(DATA_DIR, "media");
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep)) throw new Error("Invalid media path");
  return full;
}

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

const TABLE_SET = new Set<string>(TABLES);
const tbl = (t: string) => {
  if (!TABLE_SET.has(t)) throw new Error(`Unknown table ${t}`);
  return `gtm.${t}`;
};

export async function list<K extends TableName>(table: K): Promise<Tables[K][]> {
  const pool = db();
  if (pool) {
    const { rows } = await pool.query(`select data from ${tbl(table)} order by created_at desc`);
    return rows.map((r) => r.data as Tables[K]);
  }
  const rows = [...(mem()[table] as Map<string, Tables[K]>).values()].map((r) => structuredClone(r));
  return rows.sort((a, b) => String((b as { createdAt?: string }).createdAt ?? "").localeCompare(String((a as { createdAt?: string }).createdAt ?? "")));
}

export async function get<K extends TableName>(table: K, id: string): Promise<Tables[K] | null> {
  const pool = db();
  if (pool) {
    const { rows } = await pool.query(`select data from ${tbl(table)} where id = $1`, [id]);
    return (rows[0]?.data as Tables[K]) ?? null;
  }
  const row = (mem()[table] as Map<string, Tables[K]>).get(id);
  return row ? structuredClone(row) : null;
}

export async function remove<K extends TableName>(table: K, id: string): Promise<void> {
  const pool = db();
  if (pool) {
    await pool.query(`delete from ${tbl(table)} where id = $1`, [id]);
    return;
  }
  (mem()[table] as Map<string, Tables[K]>).delete(id);
  persist();
}

export async function put<K extends TableName>(table: K, row: Tables[K] & { id: string }): Promise<Tables[K]> {
  const pool = db();
  if (pool) {
    const createdAt = (row as { createdAt?: string }).createdAt;
    await pool.query(
      `insert into ${tbl(table)} (id, data, created_at) values ($1, $2, coalesce($3::timestamptz, now()))
       on conflict (id) do update set data = excluded.data, updated_at = now()`,
      [row.id, JSON.stringify(row), createdAt ?? null],
    );
    return row;
  }
  (mem()[table] as Map<string, Tables[K]>).set(row.id, structuredClone(row));
  persist();
  return row;
}

export async function metrics(): Promise<MetricDay[]> {
  const pool = db();
  if (pool) {
    const { rows } = await pool.query(
      `select to_char(date, 'YYYY-MM-DD') as date, channel, sum(spend)::float8 as spend, sum(revenue)::float8 as revenue, sum(conversions)::float8 as conversions
       from gtm.metrics_daily group by date, channel order by date`,
    );
    return rows as MetricDay[];
  }
  return mem().metrics;
}

const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4", mp3: "audio/mpeg", mpeg: "audio/mpeg", wav: "audio/wav" };

/** Reads a stored media file by its relative path: local disk first, then Supabase Storage. */
export async function readMedia(rel: string): Promise<Buffer | null> {
  if (rel.split("/").includes("..")) throw new Error("Invalid media path");
  try {
    return fs.readFileSync(mediaPath(rel));
  } catch {}
  const bucket = storage();
  if (!bucket) return null;
  const { data, error } = await bucket.download(rel);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

const relOf = (url: string) => decodeURIComponent(url.slice("/api/media/".length));

/** Loads stored media (local /api/media path, https URL or data URL) as a data URL for model inputs and ffmpeg. */
export async function mediaDataUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  if (url.startsWith("/api/media/")) {
    const rel = relOf(url);
    const buf = await readMedia(rel);
    if (!buf) throw new Error(`Media not found: ${rel}`);
    const ext = rel.split(".").pop()?.toLowerCase() ?? "";
    return `data:${MIME[ext] ?? "application/octet-stream"};base64,${buf.toString("base64")}`;
  }
  if (!url.startsWith("https://")) throw new Error("Unsupported media URL");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Media fetch failed (${res.status})`);
  return `data:${res.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream"};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}

/** A local file path for stored media (for tools like ffmpeg that need a file), downloading it if needed. */
export async function mediaFile(url: string): Promise<string | null> {
  if (!url.startsWith("/api/media/")) return null;
  const rel = relOf(url);
  try {
    const local = mediaPath(rel);
    if (fs.existsSync(local)) return local;
  } catch {
    return null;
  }
  const buf = await readMedia(rel);
  if (!buf) return null;
  const tmp = path.join(os.tmpdir(), "gtm-media", rel);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, buf);
  return tmp;
}

/** Saves a data URL and returns its app URL (/api/media/...). Uses Supabase Storage when configured, else local disk. */
export async function storeMedia(dataUrl: string, rel: string): Promise<string> {
  if (!dataUrl.startsWith("data:")) return dataUrl;
  const [meta, b64] = dataUrl.split(",");
  const contentType = meta.slice(5).split(";")[0];
  const ext = contentType.split("/")[1]?.replace("jpeg", "jpg").replace(/[^a-z0-9]/g, "") || "bin";
  const file = rel.replace(/\.[a-z0-9]+$/i, "") + "." + ext;
  if (file.split("/").includes("..")) throw new Error("Invalid media path");
  const bucket = storage();
  if (bucket) {
    const { error } = await bucket.upload(file, Buffer.from(b64, "base64"), { contentType, upsert: true });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
    return `/api/media/${file}`;
  }
  if (!canPersist || contentType === "image/svg+xml") return dataUrl;
  const full = mediaPath(file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, Buffer.from(b64, "base64"));
  return `/api/media/${file}`;
}
