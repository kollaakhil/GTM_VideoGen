// Copies the local store (.data/db.json + .data/media) into Supabase: rows into the gtm schema
// (DATABASE_URL) and media files into the private gtm-media bucket (NEXT_PUBLIC_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY). Seeded demo rows are skipped. Safe to re-run.
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const raw = JSON.parse(fs.readFileSync(path.join(dataDir, "db.json"), "utf8"));
const tables = ["brands", "studio_runs", "creatives", "inbox_items", "campaigns", "signal_events", "prompt_library"];
const isDemo = (r) => String(r.id).includes("_demo");

if (process.env.DATABASE_URL) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    for (const t of tables) {
      const rows = (raw[t] ?? []).filter((r) => !isDemo(r));
      for (const r of rows) {
        await client.query(
          `insert into gtm.${t} (id, data, created_at) values ($1, $2, coalesce($3::timestamptz, now()))
           on conflict (id) do update set data = excluded.data, updated_at = now()`,
          [r.id, JSON.stringify(r), r.createdAt ?? null],
        );
      }
      console.log(`${t}: ${rows.length} rows`);
    }
  } finally {
    await client.end();
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (url && key) {
  const bucket = createClient(url, key, { auth: { persistSession: false } }).storage.from("gtm-media");
  const root = path.join(dataDir, "media");
  const files = fs.existsSync(root) ? fs.readdirSync(root, { recursive: true }).map(String).filter((f) => fs.statSync(path.join(root, f)).isFile()) : [];
  const types = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", mp4: "video/mp4", mp3: "audio/mpeg", wav: "audio/wav", ttf: "font/ttf" };
  let n = 0;
  for (const f of files) {
    const rel = f.split(path.sep).join("/");
    const { error } = await bucket.upload(rel, fs.readFileSync(path.join(root, f)), { contentType: types[rel.split(".").pop()] ?? "application/octet-stream", upsert: true });
    if (error) throw new Error(`${rel}: ${error.message}`);
    n++;
  }
  console.log(`media: ${n} files uploaded`);
} else {
  console.log("media: skipped (set SUPABASE_SERVICE_ROLE_KEY to upload)");
}
