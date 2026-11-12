// Applies supabase/migrations/*.sql in order, once each. Usage: DATABASE_URL=... node scripts/db-migrate.mjs
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const dir = path.join(process.cwd(), "supabase/migrations");
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query("create schema if not exists gtm; create table if not exists gtm.schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await client.query("select name from gtm.schema_migrations")).rows.map((r) => r.name));
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(f)) continue;
    await client.query("begin");
    try {
      await client.query(fs.readFileSync(path.join(dir, f), "utf8"));
      await client.query("insert into gtm.schema_migrations (name) values ($1)", [f]);
      await client.query("commit");
      console.log("applied", f);
    } catch (e) {
      await client.query("rollback");
      throw e;
    }
  }
  console.log("migrations up to date");
} finally {
  await client.end();
}
