-- Vigil · run once in Supabase → SQL Editor → New query → Run.
-- Safe to re-run.

create table if not exists public.watches (
  id             text primary key,
  token          text not null,
  telegram_start text unique,
  active         boolean not null default true,
  ip_hash        text,
  created_at     timestamptz not null default now(),
  data           jsonb not null
);
create index if not exists watches_active_idx on public.watches (active, created_at);
create index if not exists watches_ip_idx     on public.watches (ip_hash, created_at);

-- rate-limit counters (pruned by every sweep)
create table if not exists public.hits (
  id  bigserial primary key,
  key text not null,
  at  timestamptz not null default now()
);
create index if not exists hits_key_at_idx on public.hits (key, at);

-- small key/value table (fingerprint of the last NASA data the sweep processed)
create table if not exists public.meta (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

-- Lock the tables down: with RLS on and no policies, the public "anon" key can read nothing.
-- Only the server, using the service_role key, can touch them.
alter table public.watches enable row level security;
alter table public.hits    enable row level security;
alter table public.meta    enable row level security;
