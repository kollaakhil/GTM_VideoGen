-- GTM Engine lives in its own schema so it can share a Supabase project with other apps.
-- The schema is not exposed to the Data API; only the server (direct Postgres) reads or writes it.
create schema if not exists gtm;
revoke all on schema gtm from public, anon, authenticated;

-- Document tables (app objects stored as jsonb)
create table if not exists gtm.brands (id text primary key, data jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists gtm.studio_runs (id text primary key, data jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists gtm.creatives (id text primary key, data jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists gtm.inbox_items (id text primary key, data jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists gtm.campaigns (id text primary key, data jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists gtm.signal_events (id text primary key, data jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists gtm.prompt_library (id text primary key, data jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create index if not exists creatives_run_idx on gtm.creatives ((data->>'runId'));
create index if not exists studio_runs_brand_idx on gtm.studio_runs ((data->>'brandUrl'));

-- Typed analytics table filled by the ad/analytics sync jobs
create table if not exists gtm.metrics_daily (
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

-- Private media bucket; the app serves files through its authenticated /api/media route
insert into storage.buckets (id, name, public) values ('gtm-media', 'gtm-media', false) on conflict (id) do nothing;

do $$
declare t text;
begin
  foreach t in array array['brands','studio_runs','creatives','inbox_items','campaigns','signal_events','prompt_library','metrics_daily'] loop
    execute format('alter table gtm.%I enable row level security', t);
    execute format('revoke all on gtm.%I from public, anon, authenticated', t);
  end loop;
end $$;
