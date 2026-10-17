-- Initial Onchain Radar schema. Apply through Supabase SQL Editor or the Supabase CLI.
-- Service-role credentials are server-only; no browser policies are granted.
create extension if not exists pgcrypto;

create table if not exists public.radar_candidates (
  id text primary key,
  chain text not null check (chain in ('solana','ethereum','base','arbitrum','optimism','polygon','bsc')),
  token_address text,
  name text not null,
  symbol text not null,
  market_metrics jsonb not null default '{}'::jsonb,
  payload jsonb not null,
  created_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index if not exists radar_candidates_chain_address_unique on public.radar_candidates(chain, lower(token_address)) where token_address is not null;
create index if not exists radar_candidates_updated_at_idx on public.radar_candidates(updated_at desc);
create index if not exists radar_candidates_chain_idx on public.radar_candidates(chain);

create table if not exists public.radar_security_reports (
  chain text not null,
  token_address text not null,
  provider text not null,
  verdict text not null check (verdict in ('PASS','WARNING','FAIL','PENDING','UNKNOWN','STALE')),
  risk_flags text[] not null default '{}',
  evidence jsonb not null default '[]'::jsonb,
  assessed_at timestamptz not null,
  expires_at timestamptz,
  report jsonb not null,
  checked_at timestamptz not null,
  primary key(chain, token_address, provider)
);
create index if not exists radar_security_checked_idx on public.radar_security_reports(checked_at desc);
create index if not exists radar_security_verdict_idx on public.radar_security_reports(verdict, checked_at desc);

create table if not exists public.radar_social_posts (
  id text primary key,
  platform text not null default 'x',
  external_post_id text,
  author text,
  text text not null,
  url text,
  published_at timestamptz,
  engagement_metrics jsonb not null default '{}'::jsonb,
  extracted_entities jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now()
);
create unique index if not exists radar_social_post_external_unique on public.radar_social_posts(platform, external_post_id) where external_post_id is not null;
create index if not exists radar_social_posts_published_idx on public.radar_social_posts(published_at desc);

create table if not exists public.radar_nfts (
  id text primary key,
  collection_name text not null,
  chain text not null,
  collection_address text,
  mint_address text,
  mint_type text not null,
  mint_price_usd numeric,
  mint_start timestamptz,
  mint_end timestamptz,
  eligibility text,
  verification_status text not null,
  source_urls text[] not null default '{}',
  security_status text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists radar_nfts_mint_start_idx on public.radar_nfts(mint_start);
create index if not exists radar_nfts_chain_status_idx on public.radar_nfts(chain, verification_status);

create table if not exists public.radar_gtd (
  id text primary key,
  project_name text not null,
  chain text not null,
  mint_at timestamptz,
  status text not null,
  mint_price_usd numeric,
  allocation text,
  eligibility text,
  source_urls text[] not null default '{}',
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists radar_gtd_mint_at_idx on public.radar_gtd(mint_at);
create index if not exists radar_gtd_status_idx on public.radar_gtd(status);

create table if not exists public.radar_narratives (
  id text primary key,
  name text not null,
  keywords text[] not null default '{}',
  mention_metrics jsonb not null default '{}'::jsonb,
  momentum_score numeric,
  first_seen_at timestamptz,
  updated_at timestamptz not null default now(),
  payload jsonb not null
);
create index if not exists radar_narratives_momentum_idx on public.radar_narratives(momentum_score desc nulls last);

create table if not exists public.radar_cto_evidence (
  id text primary key,
  chain text not null,
  token_address text,
  classification text not null,
  confidence numeric,
  evidence_urls text[] not null default '{}',
  evidence_summary text,
  assessed_at timestamptz not null,
  evidence jsonb not null default '{}'::jsonb
);
create index if not exists radar_cto_evidence_token_idx on public.radar_cto_evidence(chain, lower(token_address));

create table if not exists public.radar_sync_state (
  source text primary key,
  last_successful_at timestamptz,
  details jsonb not null default '{}'::jsonb
);
create table if not exists public.radar_ingestion_events (
  event_id text primary key,
  source text not null,
  ingested_at timestamptz not null default now()
);

alter table public.radar_candidates enable row level security;
alter table public.radar_security_reports enable row level security;
alter table public.radar_social_posts enable row level security;
alter table public.radar_nfts enable row level security;
alter table public.radar_gtd enable row level security;
alter table public.radar_narratives enable row level security;
alter table public.radar_cto_evidence enable row level security;
alter table public.radar_sync_state enable row level security;
alter table public.radar_ingestion_events enable row level security;

revoke all on public.radar_candidates, public.radar_security_reports, public.radar_social_posts,
  public.radar_nfts, public.radar_gtd, public.radar_narratives, public.radar_cto_evidence,
  public.radar_sync_state, public.radar_ingestion_events from anon, authenticated;
-- Do not add anon/authenticated policies. Use the server-only Supabase service role.
