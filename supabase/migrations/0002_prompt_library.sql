create table if not exists prompt_library (id text primary key, data jsonb not null, created_at timestamptz not null default now());
alter table prompt_library enable row level security;
