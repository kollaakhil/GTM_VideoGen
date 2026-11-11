-- Document tables (app objects stored as jsonb)
create table if not exists brands (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists studio_runs (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists creatives (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists inbox_items (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists campaigns (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists signal_events (id text primary key, data jsonb not null, created_at timestamptz not null default now());

-- Typed analytics table filled by the ad/analytics sync jobs
create table if not exists metrics_daily (
  date date not null,
  channel text not null,
  campaign_id text not null default '',
  creative_id text not null default '',
  spend numeric not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  conversions numeric not null default 0,
  revenue numeric not null default 0,
  primary key (date, channel, campaign_id, creative_id)
);

-- Creative assets
insert into storage.buckets (id, name, public) values ('creatives', 'creatives', true) on conflict (id) do nothing;

-- Server-only access (service role bypasses RLS)
alter table brands enable row level security;
alter table studio_runs enable row level security;
alter table creatives enable row level security;
alter table inbox_items enable row level security;
alter table campaigns enable row level security;
alter table signal_events enable row level security;
alter table metrics_daily enable row level security;
