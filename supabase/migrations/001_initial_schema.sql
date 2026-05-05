-- AEONOS (AEON.OS) — Initial Schema
-- Run this in a NEW isolated Supabase project (not Pemba/sailor-bot)

-- Enable pgvector for semantic search
create extension if not exists vector;

-- ── AEO Knowledge Base ─────────────────────────────────────────────────────────
-- Core knowledge entries — seeded from GEO skill playbook + AEONOS campaigns
-- Queried at inference time alongside live Norg MCP data

create table if not exists aeo_knowledge (
  id              uuid primary key default gen_random_uuid(),
  category        text not null,           -- geo_strategy | on_page | schema_markup | keyword_research | backlink_strategy | content_strategy | aeo_fundamentals | competitor_analysis
  query_pattern   text not null,           -- human-readable description of what queries this matches
  content         jsonb not null,          -- the actual knowledge payload
  sources         text[] default '{}',     -- citations / provenance
  last_updated    timestamptz default now(),
  embedding       vector(1536),            -- for semantic similarity search (OpenAI text-embedding-3-small)
  unique (category, query_pattern)
);

alter table aeo_knowledge enable row level security;

-- Admin can do everything
create policy "admin_all" on aeo_knowledge
  for all using (true);

-- Service role can do everything (for the agent)
-- (service key bypasses RLS by default in Supabase)

create index on aeo_knowledge using ivfflat (embedding vector_cosine_ops)
  with (lists = 50);

-- ── Caller Memory ──────────────────────────────────────────────────────────────
-- Per-caller persistent context. Each external agent gets their own memory slot.

create table if not exists caller_memory (
  id              uuid primary key default gen_random_uuid(),
  caller_id       text not null unique,    -- stable identifier from the calling agent (A2A caller DID or API key hash)
  site_url        text,
  business_type   text,
  search_terms    text[] default '{}',     -- keywords they've asked about
  audit_data      jsonb default '{}',      -- last audit snapshot
  context         jsonb default '{}',      -- free-form context (ICP, goals, pain points)
  query_count     int default 0,
  total_paid_usdc decimal(10,4) default 0,
  updated_at      timestamptz default now()
);

alter table caller_memory enable row level security;

create policy "admin_all" on caller_memory
  for all using (true);

-- ── Query Log ──────────────────────────────────────────────────────────────────
-- Audit trail for every agent query. Used for billing, debugging, and improving the knowledge base.

create table if not exists query_log (
  id                    uuid primary key default gen_random_uuid(),
  caller_id             text,
  query                 text not null,
  norg_data_used        boolean default false,
  knowledge_entries_hit int default 0,
  response_tokens       int,
  payment_usdc          decimal(10,4) default 0,
  payment_tx_hash       text,             -- Base blockchain tx hash if x402 payment
  quality_score         int,              -- 1-5 if caller provides feedback
  created_at            timestamptz default now()
);

alter table query_log enable row level security;

create policy "admin_all" on query_log
  for all using (true);

-- ── Async Tasks ───────────────────────────────────────────────────────────────
-- Task state for async pattern: POST ?async=true → poll GET ?task_id=xxx

create table if not exists tasks (
  id            uuid primary key default gen_random_uuid(),
  caller_id     text not null,
  query         text not null,
  status        text not null default 'working',  -- working | completed | failed
  result        jsonb,                             -- { artifact: { parts, index }, tool_calls, tokens }
  error         text,
  created_at    timestamptz default now(),
  completed_at  timestamptz
);

alter table tasks enable row level security;

create policy "admin_all" on tasks
  for all using (true);

-- ── Indexes ────────────────────────────────────────────────────────────────────

create index on aeo_knowledge (category);
create index on caller_memory (caller_id);
create index on query_log (caller_id, created_at desc);
create index on query_log (created_at desc);
create index on tasks (caller_id, created_at desc);
create index on tasks (status);
