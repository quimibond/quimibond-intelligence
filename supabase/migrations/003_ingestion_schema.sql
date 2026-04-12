-- supabase/migrations/003_ingestion_schema.sql
-- Fase 0 Plan 1: Ingestion core schema (5 tables)

create schema if not exists ingestion;

-- 1. source_registry: catalog of sources and their tables
create table ingestion.source_registry (
  source_id text not null,
  table_name text not null,
  entity_kind text not null,
  sla_minutes int not null check (sla_minutes > 0),
  priority text not null check (priority in ('critical','important','context')),
  owner_agent text,
  reconciliation_window_days int,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source_id, table_name)
);

comment on table ingestion.source_registry is
  'Catalog of data sources and the Supabase tables they populate. Fase 0.';

-- 2. sync_run: one row per sync execution
create table ingestion.sync_run (
  run_id uuid primary key default gen_random_uuid(),
  source_id text not null,
  table_name text not null,
  run_type text not null check (run_type in ('incremental','full','backfill','retry')),
  triggered_by text not null check (triggered_by in ('cron','event','manual','reconciliation')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'running'
    check (status in ('running','success','partial','failed')),
  rows_attempted int not null default 0,
  rows_succeeded int not null default 0,
  rows_failed int not null default 0,
  rows_skipped int not null default 0,
  high_watermark text,
  metadata jsonb not null default '{}'::jsonb,
  foreign key (source_id, table_name) references ingestion.source_registry(source_id, table_name)
);

create index sync_run_source_table_started_idx
  on ingestion.sync_run(source_id, table_name, started_at desc);
create index sync_run_status_idx
  on ingestion.sync_run(status) where status in ('running','partial','failed');

-- 3. sync_failure: one row per failed entity, for targeted retry
create table ingestion.sync_failure (
  failure_id uuid primary key default gen_random_uuid(),
  run_id uuid not null references ingestion.sync_run(run_id) on delete restrict,
  source_id text not null,
  table_name text not null,
  entity_id text not null,
  error_code text not null,
  error_detail text not null,
  payload_snapshot jsonb,
  retry_count int not null default 0,
  status text not null default 'pending'
    check (status in ('pending','retrying','resolved','abandoned')),
  first_seen_at timestamptz not null default now(),
  last_tried_at timestamptz not null default now(),
  resolved_at timestamptz,
  foreign key (source_id, table_name) references ingestion.source_registry(source_id, table_name)
);

-- Unique constraint: one open failure per (source, table, entity) at a time.
-- Enables ON CONFLICT DO UPDATE in report_failure for idempotency.
create unique index sync_failure_open_idx
  on ingestion.sync_failure(source_id, table_name, entity_id)
  where status in ('pending','retrying');

create index sync_failure_status_idx
  on ingestion.sync_failure(source_id, table_name, status);

create index sync_failure_run_id_idx on ingestion.sync_failure(run_id);

-- 4. reconciliation_run: nightly count comparison output
create table ingestion.reconciliation_run (
  reconciliation_id uuid primary key default gen_random_uuid(),
  source_id text not null,
  table_name text not null,
  ran_at timestamptz not null default now(),
  window_start timestamptz,
  window_end timestamptz,
  source_count int,
  supabase_count int not null,
  divergence int,
  missing_entity_ids text[],
  status text not null
    check (status in ('clean','divergent_positive','divergent_negative','unknown')),
  auto_healed_count int not null default 0,
  foreign key (source_id, table_name) references ingestion.source_registry(source_id, table_name),
  check (
    (source_count is null and divergence is null and status = 'unknown')
    or (source_count is not null and divergence is not null and status <> 'unknown')
  )
);

create index reconciliation_run_source_table_ran_idx
  on ingestion.reconciliation_run(source_id, table_name, ran_at desc);

-- 5. sla_breach: log of SLA violations (staleness, stuck reconcile, failure backlog)
create table ingestion.sla_breach (
  breach_id uuid primary key default gen_random_uuid(),
  source_id text not null,
  table_name text not null,
  breach_type text not null
    check (breach_type in ('staleness','reconciliation_stale','failure_backlog')),
  detected_at timestamptz not null default now(),
  sla_minutes int not null,
  actual_minutes int not null,
  resolved_at timestamptz,
  foreign key (source_id, table_name) references ingestion.source_registry(source_id, table_name)
);

create index sla_breach_open_idx
  on ingestion.sla_breach(source_id, table_name, breach_type)
  where resolved_at is null;

-- updated_at trigger on source_registry
create or replace function ingestion.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger source_registry_touch
  before update on ingestion.source_registry
  for each row execute function ingestion.touch_updated_at();
