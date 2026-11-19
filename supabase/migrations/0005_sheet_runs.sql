create table if not exists gtm.sheet_runs (id text primary key, data jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
alter table gtm.sheet_runs enable row level security;
revoke all on gtm.sheet_runs from public, anon, authenticated;
