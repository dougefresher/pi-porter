create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists btree_gin;

-- pgvector is expected for semantic memory. Keep this migration explicit so
-- `suka doctor` can eventually report a useful error on systems missing it.
create extension if not exists vector;

create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists sessions (
  session_key text primary key,
  agent_id text not null,
  channel text not null,
  account_id text not null,
  peer_kind text not null,
  peer_id text not null,
  thread_id text,
  title text,
  message_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists inbound_events (
  id bigserial primary key,
  session_key text not null references sessions(session_key),
  channel text not null,
  account_id text not null default 'default',
  chat_id text not null,
  sender_id text not null,
  content text not null,
  attachments jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

create index if not exists inbound_events_pending_idx on inbound_events (created_at, id) where status = 'pending';
create index if not exists inbound_events_session_idx on inbound_events (session_key, id);
create index if not exists inbound_events_metadata_gin_idx on inbound_events using gin (metadata);

create table if not exists outbound_deliveries (
  id bigserial primary key,
  inbound_id bigint references inbound_events(id) on delete set null,
  session_key text not null references sessions(session_key),
  channel text not null,
  account_id text not null default 'default',
  chat_id text not null,
  type text not null default 'message' check (type in ('message', 'typing_on', 'typing_off')),
  content text,
  media jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  error text
);

create index if not exists outbound_deliveries_pending_idx on outbound_deliveries (created_at, id) where status = 'pending';
create index if not exists outbound_deliveries_session_idx on outbound_deliveries (session_key, id);
create index if not exists outbound_deliveries_metadata_gin_idx on outbound_deliveries using gin (metadata);

create table if not exists transcript_rows (
  id bigserial primary key,
  session_key text not null references sessions(session_key),
  inbound_id bigint references inbound_events(id) on delete set null,
  role text not null check (role in ('user', 'assistant', 'system', 'tool', 'context')),
  content text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists transcript_rows_session_idx on transcript_rows (session_key, id);
create index if not exists transcript_rows_payload_gin_idx on transcript_rows using gin (payload);
