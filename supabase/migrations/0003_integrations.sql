create table if not exists gtm.integrations (id text primary key, data jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
alter table gtm.integrations enable row level security;
revoke all on gtm.integrations from public, anon, authenticated;
