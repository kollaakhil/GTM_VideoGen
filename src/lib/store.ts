import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { seed } from "./seed";
import type { Campaign, Creative, InboxItem, MetricDay, SignalEvent, StudioRun, Brand } from "./types";

export interface Tables {
  brands: Brand;
  studio_runs: StudioRun;
  creatives: Creative;
  inbox_items: InboxItem;
  campaigns: Campaign;
  signal_events: SignalEvent;
}
export type TableName = keyof Tables;

let client: SupabaseClient | null = null;
function supabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  client ??= createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export function usingSupabase() {
  return supabase() !== null;
}

type Mem = { [K in TableName]: Map<string, Tables[K]> } & { metrics: MetricDay[] };
const g = globalThis as unknown as { __gtmMem?: Mem };
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const TABLES: TableName[] = ["brands", "studio_runs", "creatives", "inbox_items", "campaigns", "signal_events"];
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

export function mediaPath(rel: string) {
  const root = path.join(DATA_DIR, "media");
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep)) throw new Error("Invalid media path");
  return full;
}

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export async function list<K extends TableName>(table: K): Promise<Tables[K][]> {
  const sb = supabase();
  if (sb) {
    const { data, error } = await sb.from(table).select("data").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => r.data as Tables[K]);
  }
  const rows = [...(mem()[table] as Map<string, Tables[K]>).values()];
  return rows.sort((a, b) => String((b as { createdAt?: string }).createdAt ?? "").localeCompare(String((a as { createdAt?: string }).createdAt ?? "")));
}

export async function get<K extends TableName>(table: K, id: string): Promise<Tables[K] | null> {
  const sb = supabase();
  if (sb) {
    const { data, error } = await sb.from(table).select("data").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return (data?.data as Tables[K]) ?? null;
  }
  return (mem()[table] as Map<string, Tables[K]>).get(id) ?? null;
}

export async function put<K extends TableName>(table: K, row: Tables[K] & { id: string }): Promise<Tables[K]> {
  const sb = supabase();
  if (sb) {
    const { error } = await sb.from(table).upsert({ id: row.id, data: row });
    if (error) throw new Error(error.message);
    return row;
  }
  (mem()[table] as Map<string, Tables[K]>).set(row.id, row);
  persist();
  return row;
}

export async function metrics(): Promise<MetricDay[]> {
  const sb = supabase();
  if (sb) {
    const { data, error } = await sb.from("metrics_daily").select("date,channel,spend,revenue,conversions").order("date");
    if (error) throw new Error(error.message);
    return (data ?? []) as MetricDay[];
  }
  return mem().metrics;
}

export async function storeMedia(dataUrl: string, rel: string): Promise<string> {
  if (!dataUrl.startsWith("data:")) return dataUrl;
  const [meta, b64] = dataUrl.split(",");
  const contentType = meta.slice(5).split(";")[0];
  const ext = contentType.split("/")[1]?.replace("jpeg", "jpg").replace(/[^a-z0-9]/g, "") || "bin";
  const file = rel.replace(/\.[a-z0-9]+$/i, "") + "." + ext;
  const sb = supabase();
  if (sb) {
    const { error } = await sb.storage.from("creatives").upload(file, Buffer.from(b64, "base64"), { contentType, upsert: true });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
    return sb.storage.from("creatives").getPublicUrl(file).data.publicUrl;
  }
  if (!canPersist || contentType === "image/svg+xml") return dataUrl;
  const full = mediaPath(file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, Buffer.from(b64, "base64"));
  return `/api/media/${file}`;
}
