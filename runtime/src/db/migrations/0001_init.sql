create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists btree_gin;

-- pgvector is expected for semantic memory. Keep this migration explicit so
-- `porter doctor` can eventually report a useful error on systems missing it.
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

create table if not exists session_archives (
  id bigserial primary key,
  session_key text not null references sessions(session_key),
  reason text not null,
  pi_session_id text,
  line_count integer not null,
  content_bytes integer not null,
  created_at timestamptz not null default now()
);

create index if not exists session_archives_session_idx on session_archives (session_key, id);

create table if not exists session_archive_contents (
  archive_id bigint primary key references session_archives (id) on delete cascade,
  content bytea not null
);

create table if not exists scheduled_tasks (
  id text primary key,
  name text,
  prompt text not null,
  agent_session_key text not null references sessions (session_key),
  report_session_key text references sessions (session_key),
  workdir text,
  schedule_type text not null check (schedule_type in ('cron', 'interval', 'once')),
  schedule_value text not null,
  next_run timestamptz,
  last_run timestamptz,
  last_result text,
  status text not null default 'active' check (status in ('active', 'paused', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scheduled_tasks_due_idx on scheduled_tasks (next_run, id)
  where status = 'active' and next_run is not null;

create index if not exists scheduled_tasks_status_idx on scheduled_tasks (status);

create table if not exists scheduled_task_runs (
  id bigserial primary key,
  task_id text not null references scheduled_tasks (id) on delete cascade,
  inbound_id bigint references inbound_events (id) on delete set null,
  run_at timestamptz not null default now(),
  duration_ms integer,
  status text not null check (status in ('success', 'error')),
  result text,
  error text
);

create index if not exists scheduled_task_runs_task_idx on scheduled_task_runs (task_id, id);
