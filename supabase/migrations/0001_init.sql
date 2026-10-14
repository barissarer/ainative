-- Postgres schema (Supabase-compatible). Nested structures are stored as JSONB.
create table if not exists clients (
  id text primary key,
  name text not null,
  sector text not null,
  sub_sector text,
  region text,
  size text,
  owner text,
  relationship_notes text,
  created_at timestamptz not null default now()
);

create table if not exists qualifications (
  id text primary key,
  client_id text not null references clients(id),
  version int not null,
  data jsonb not null,            -- dimensions, evidence, weights, gate, override, narrative
  overall_score numeric not null,
  tier text not null,
  confidence text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (client_id, version)
);

create table if not exists evidence (
  id text primary key,
  qualification_id text not null references qualifications(id),
  source text not null,
  snippet text not null,
  type text not null check (type in ('Fact','Inference','User-provided','Leader-informed')),
  retrieved_at timestamptz not null default now()
);

create table if not exists sector_research (
  sector text primary key,
  summary text not null,
  ai_impact_view text not null,
  sources jsonb not null default '[]',
  refreshed_at timestamptz not null default now()
);

create table if not exists leader_inputs (
  id text primary key,
  qualification_id text not null references qualifications(id),  -- the version the leader reacted to
  client_id text not null references clients(id),
  author_id text not null,
  author_name text not null,
  author_role text not null,
  brand_permission jsonb not null,
  audit_status jsonb not null,
  exec_relationship jsonb not null,
  source text not null check (source in ('structured','conversational')),
  confirmed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists gates (
  id text primary key,
  client_id text not null references clients(id),
  type text not null default 'audit_independence',
  status text not null check (status in ('none','restricted','unresolved','cleared')),
  set_by text,
  reason text,
  cleared_by text,
  updated_at timestamptz not null default now()
);

create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  entity text not null,
  entity_id text not null,
  detail jsonb not null default '{}',
  reason text
);
