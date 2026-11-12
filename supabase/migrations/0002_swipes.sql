create table if not exists gtm.swipes (id text primary key, data jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
alter table gtm.swipes enable row level security;
revoke all on gtm.swipes from public, anon, authenticated;
