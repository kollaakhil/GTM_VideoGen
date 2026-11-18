create table if not exists gtm.judge_calibrations (id text primary key, data jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
alter table gtm.judge_calibrations enable row level security;
revoke all on gtm.judge_calibrations from public, anon, authenticated;
