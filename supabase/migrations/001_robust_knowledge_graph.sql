create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  dob date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sources (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('emr', 'voice', 'doctor_note', 'manual')),
  title text not null,
  captured_at timestamptz not null,
  raw_text text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.source_chunks (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id text not null references public.sources(id) on delete cascade,
  ordinal int not null,
  start_offset int not null,
  end_offset int not null,
  text text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.extraction_runs (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id text not null references public.sources(id) on delete cascade,
  model text not null,
  prompt_version text not null,
  status text not null check (status in ('completed', 'failed', 'fallback')),
  started_at timestamptz not null,
  completed_at timestamptz,
  error text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.candidate_facts (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id text not null references public.sources(id) on delete cascade,
  chunk_id text references public.source_chunks(id) on delete set null,
  kind text not null,
  label text not null,
  normalized_label text not null,
  value jsonb,
  unit text,
  observed_at timestamptz not null,
  status text,
  relevance text not null check (relevance in ('graph', 'evidence_only', 'ignore')),
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  evidence_quote text,
  negated boolean not null default false,
  uncertain boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.clinical_facts (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id text not null unique,
  source_id text not null references public.sources(id) on delete cascade,
  chunk_id text references public.source_chunks(id) on delete set null,
  entity_id text,
  kind text not null,
  label text not null,
  normalized_label text not null,
  value jsonb,
  unit text,
  observed_at timestamptz not null,
  status text,
  relevance text not null check (relevance in ('graph', 'evidence_only', 'ignore')),
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  review_status text not null check (review_status in ('accepted', 'needs_review', 'rejected', 'superseded')),
  provenance jsonb not null default '[]'::jsonb,
  evidence_quote text,
  negated boolean not null default false,
  uncertain boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.entities (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  canonical_label text not null,
  aliases text[] not null default '{}',
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  review_status text not null check (review_status in ('accepted', 'needs_review', 'rejected', 'superseded')),
  fact_ids text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, kind, canonical_label)
);

create table if not exists public.entity_aliases (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_id text not null references public.entities(id) on delete cascade,
  alias text not null,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  unique (user_id, entity_id, alias)
);

create table if not exists public.graph_edges (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  from_entity_id text not null references public.entities(id) on delete cascade,
  to_entity_id text not null references public.entities(id) on delete cascade,
  relation text not null,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  evidence_fact_ids text[] not null default '{}',
  provenance jsonb not null default '[]'::jsonb,
  review_status text not null check (review_status in ('accepted', 'needs_review', 'rejected', 'superseded')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, from_entity_id, to_entity_id, relation)
);

create table if not exists public.review_items (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('fact', 'entity', 'relationship')),
  target_id text not null,
  reason text not null,
  status text not null check (status in ('open', 'resolved')),
  created_at timestamptz not null default now()
);

create table if not exists public.risk_alerts (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  severity text not null check (severity in ('high', 'medium', 'low')),
  title text not null,
  time_horizon text not null,
  specialty text[] not null default '{}',
  explanation text not null,
  evidence_fact_ids text[] not null default '{}',
  evidence_event_ids text[] not null default '{}',
  suggested_questions text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_sources_user_id on public.sources(user_id);
create index if not exists idx_source_chunks_source_id on public.source_chunks(source_id);
create index if not exists idx_candidate_facts_user_relevance on public.candidate_facts(user_id, relevance);
create index if not exists idx_clinical_facts_user_kind on public.clinical_facts(user_id, kind);
create index if not exists idx_entities_user_kind on public.entities(user_id, kind);
create index if not exists idx_graph_edges_from on public.graph_edges(user_id, from_entity_id);
create index if not exists idx_graph_edges_to on public.graph_edges(user_id, to_entity_id);

alter table public.profiles enable row level security;
alter table public.sources enable row level security;
alter table public.source_chunks enable row level security;
alter table public.extraction_runs enable row level security;
alter table public.candidate_facts enable row level security;
alter table public.clinical_facts enable row level security;
alter table public.entities enable row level security;
alter table public.entity_aliases enable row level security;
alter table public.graph_edges enable row level security;
alter table public.review_items enable row level security;
alter table public.risk_alerts enable row level security;

create policy "Users can manage own profile" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());
create policy "Users can manage own sources" on public.sources
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users can manage own chunks" on public.source_chunks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users can manage own extraction runs" on public.extraction_runs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users can manage own candidate facts" on public.candidate_facts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users can manage own clinical facts" on public.clinical_facts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users can manage own entities" on public.entities
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users can manage own aliases" on public.entity_aliases
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users can manage own graph edges" on public.graph_edges
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users can manage own review items" on public.review_items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users can manage own risk alerts" on public.risk_alerts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
