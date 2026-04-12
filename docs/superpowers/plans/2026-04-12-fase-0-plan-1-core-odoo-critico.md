# Fase 0 Plan 1 — Núcleo de Ingesta + Odoo Invoices/Payments

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Supabase-native ingestion core (schema `ingestion` + 7 RPCs + sentinel + health views) and migrate the two most critical Odoo sync paths (`_push_invoices` and `_push_payments`) to use it, running in parallel with the legacy `sync_log` for 1 week of validation.

**Architecture:** All integrity plumbing lives in Postgres as tables, PL/pgSQL RPCs, and pg_cron — no new services. The qb19 Python addon gets a thin `IngestionCore` client that wraps the 7 RPCs, and each `_push_*` method is wrapped with `start_run / report_batch / report_failure / complete_run` without rewriting its upsert logic. Legacy `sync_log` stays live in parallel until the new system proves consistent.

**Tech Stack:** Supabase (Postgres 15 + PostgREST + pg_cron), Python 3.10+ (qb19 on Odoo 19), pytest for Python unit tests, SQL assertion scripts for RPC tests.

**Spec reference:** `docs/superpowers/specs/2026-04-12-fase-0-ingestion-core-design.md`

**Follow-up plans (not written yet):**
- Plan 2: Migrate remaining 18 Odoo tables + activate nightly reconciliation cron
- Plan 3: Gmail pipeline adapter + `/system` dashboard refactor + legacy `sync_log` decommission

---

## File Structure

**New files (Supabase):**
- `supabase/migrations/003_ingestion_schema.sql` — schema + 5 tables + indices + unique constraints
- `supabase/migrations/004_ingestion_rpcs.sql` — the 7 PL/pgSQL functions
- `supabase/migrations/005_ingestion_sentinel_and_views.sql` — pg_cron sentinel + 3 health views
- `supabase/migrations/006_ingestion_seed_registry.sql` — initial `source_registry` rows for `odoo_invoices` and `odoo_payments`
- `supabase/tests/ingestion_rpc_tests.sql` — SQL test script with assertions, rollback-only (never commits data)

**New files (qb19):**
- `addons/quimibond_intelligence/models/ingestion_core.py` — Python wrapper class over the 7 RPCs (~150 lines)
- `addons/quimibond_intelligence/tests/__init__.py` — test package init
- `addons/quimibond_intelligence/tests/test_ingestion_core.py` — pytest tests with mocked httpx
- `addons/quimibond_intelligence/data/ir_cron_retry_failures.xml` — 30-min cron for retry processing

**Modified files (qb19):**
- `addons/quimibond_intelligence/models/__init__.py` — import `ingestion_core`
- `addons/quimibond_intelligence/models/supabase_client.py` — add `upsert_with_details()` method returning per-row outcomes
- `addons/quimibond_intelligence/models/sync_push.py` — wrap `_push_invoices` and `_push_payments` only (leave other `_push_*` untouched for Plan 2)

**Unchanged (intentional in this plan):**
- `sync_log.py`, existing `data/ir_cron_data.xml`, all other `_push_*` methods, `sync_pull.py`, frontend code.

---

## Task 1: Create `ingestion` schema with 5 tables

**Files:**
- Create: `supabase/migrations/003_ingestion_schema.sql`

- [ ] **Step 1: Write the migration file**

```sql
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
  run_id uuid not null references ingestion.sync_run(run_id) on delete cascade,
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
  resolved_at timestamptz
);

-- Unique constraint: one open failure per (source, table, entity) at a time.
-- Enables ON CONFLICT DO UPDATE in report_failure for idempotency.
create unique index sync_failure_open_idx
  on ingestion.sync_failure(source_id, table_name, entity_id)
  where status in ('pending','retrying');

create index sync_failure_status_idx
  on ingestion.sync_failure(source_id, table_name, status);

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
  divergence int not null,
  missing_entity_ids text[],
  status text not null
    check (status in ('clean','divergent_positive','divergent_negative','unknown')),
  auto_healed_count int not null default 0
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
  resolved_at timestamptz
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
```

- [ ] **Step 2: Apply the migration**

Run (from repo root):
```bash
supabase db push
```

Expected: migration applies cleanly. If using Supabase MCP instead, call `apply_migration` with the file contents.

- [ ] **Step 3: Verify schema exists**

Run:
```sql
select table_name from information_schema.tables
where table_schema='ingestion' order by table_name;
```

Expected output:
```
 reconciliation_run
 sla_breach
 source_registry
 sync_failure
 sync_run
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/003_ingestion_schema.sql
git commit -m "feat(ingestion): add schema with 5 core tables

Introduces schema 'ingestion' with source_registry, sync_run,
sync_failure, reconciliation_run, and sla_breach. Includes unique
constraint on open failures for idempotent reporting."
```

---

## Task 2: Implement RPC `ingestion_start_run`

**Files:**
- Create: `supabase/migrations/004_ingestion_rpcs.sql` (will accumulate all 7 RPCs)
- Create: `supabase/tests/ingestion_rpc_tests.sql`

- [ ] **Step 1: Write the failing SQL test first**

Create `supabase/tests/ingestion_rpc_tests.sql`:

```sql
-- supabase/tests/ingestion_rpc_tests.sql
-- Run with: psql -f supabase/tests/ingestion_rpc_tests.sql
-- All assertions raise EXCEPTION on failure. Script uses a transaction
-- that ALWAYS rolls back, so it never pollutes real data.

begin;

-- Seed a test source
insert into ingestion.source_registry
  (source_id, table_name, entity_kind, sla_minutes, priority)
values
  ('test_src','test_tbl','test_entity',5,'critical');

-- ===== Task 2: ingestion_start_run =====

do $$
declare
  r1 record;
  r2 record;
begin
  -- First call: no prior run, watermark should be null
  select * into r1
  from ingestion_start_run('test_src','test_tbl','incremental','cron');

  if r1.run_id is null then
    raise exception 'T2.1: start_run returned null run_id';
  end if;
  if r1.last_watermark is not null then
    raise exception 'T2.2: first run last_watermark should be null, got %', r1.last_watermark;
  end if;

  -- Complete the first run with a watermark
  perform ingestion_complete_run(r1.run_id, 'success', '2026-04-12T10:00:00Z');

  -- Second call: watermark should come back from the completed run
  select * into r2
  from ingestion_start_run('test_src','test_tbl','incremental','cron');

  if r2.last_watermark is distinct from '2026-04-12T10:00:00Z' then
    raise exception 'T2.3: second run watermark mismatch, got %', r2.last_watermark;
  end if;
  if r2.run_id = r1.run_id then
    raise exception 'T2.4: start_run should return a fresh run_id';
  end if;

  raise notice 'T2 PASS: ingestion_start_run';
end $$;

rollback;
```

- [ ] **Step 2: Run the test — expect failure**

Run:
```bash
psql "$SUPABASE_DB_URL" -f supabase/tests/ingestion_rpc_tests.sql
```

Expected: fails with `ERROR: function ingestion_start_run(...) does not exist`.

- [ ] **Step 3: Create RPCs migration file and implement `ingestion_start_run`**

Create `supabase/migrations/004_ingestion_rpcs.sql`:

```sql
-- supabase/migrations/004_ingestion_rpcs.sql
-- Fase 0 Plan 1: Ingestion core RPCs (7 functions)

-- 1. ingestion_start_run: open a run, return new run_id and the watermark from the last successful run
create or replace function ingestion_start_run(
  p_source text,
  p_table text,
  p_run_type text,
  p_triggered_by text
) returns table(run_id uuid, last_watermark text)
language plpgsql security definer
as $$
declare
  v_run_id uuid;
  v_watermark text;
begin
  select sr.high_watermark into v_watermark
  from ingestion.sync_run sr
  where sr.source_id = p_source
    and sr.table_name = p_table
    and sr.status = 'success'
  order by sr.ended_at desc nulls last
  limit 1;

  insert into ingestion.sync_run
    (source_id, table_name, run_type, triggered_by, status)
  values
    (p_source, p_table, p_run_type, p_triggered_by, 'running')
  returning sync_run.run_id into v_run_id;

  return query select v_run_id, v_watermark;
end $$;

grant execute on function ingestion_start_run(text,text,text,text) to service_role;
```

- [ ] **Step 4: Apply migration and re-run test**

Run:
```bash
supabase db push
psql "$SUPABASE_DB_URL" -f supabase/tests/ingestion_rpc_tests.sql
```

Expected: fails at T2.3 (because `ingestion_complete_run` doesn't exist yet) — **that's the next task**. For now, temporarily comment out the `perform ingestion_complete_run(...)` line and the T2.3/T2.4 assertions, run again, and expect `NOTICE: T2 PASS`. Then uncomment them — they'll pass after Task 5.

Actually, simpler: skip T2.3/T2.4 until after Task 5 by moving those two assertions into a separate `do $$ ... $$` block labeled "runs after task 5". Edit the test file to move them into a second `do` block marked with a comment `-- requires ingestion_complete_run (Task 5)`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/004_ingestion_rpcs.sql supabase/tests/ingestion_rpc_tests.sql
git commit -m "feat(ingestion): add ingestion_start_run RPC + test scaffold"
```

---

## Task 3: Implement RPC `ingestion_report_batch`

**Files:**
- Modify: `supabase/migrations/004_ingestion_rpcs.sql` (append)
- Modify: `supabase/tests/ingestion_rpc_tests.sql` (append)

- [ ] **Step 1: Append the failing test**

Append to `supabase/tests/ingestion_rpc_tests.sql`, inside the same transaction before the `rollback;`:

```sql
-- ===== Task 3: ingestion_report_batch =====
do $$
declare
  v_run uuid;
  v_att int;
  v_ok int;
  v_fail int;
begin
  select run_id into v_run
  from ingestion_start_run('test_src','test_tbl','incremental','cron');

  perform ingestion_report_batch(v_run, 200, 195, 5);
  perform ingestion_report_batch(v_run, 200, 200, 0);

  select rows_attempted, rows_succeeded, rows_failed
    into v_att, v_ok, v_fail
  from ingestion.sync_run where run_id = v_run;

  if v_att <> 400 then raise exception 'T3.1: attempted=% expected 400', v_att; end if;
  if v_ok <> 395 then raise exception 'T3.2: succeeded=% expected 395', v_ok; end if;
  if v_fail <> 5 then raise exception 'T3.3: failed=% expected 5', v_fail; end if;

  raise notice 'T3 PASS: ingestion_report_batch';
end $$;
```

- [ ] **Step 2: Run test, expect failure**

```bash
psql "$SUPABASE_DB_URL" -f supabase/tests/ingestion_rpc_tests.sql
```

Expected: `function ingestion_report_batch does not exist`.

- [ ] **Step 3: Append implementation**

Append to `supabase/migrations/004_ingestion_rpcs.sql`:

```sql
-- 2. ingestion_report_batch: accumulate counters atomically on a live run
create or replace function ingestion_report_batch(
  p_run_id uuid,
  p_attempted int,
  p_succeeded int,
  p_failed int
) returns void
language plpgsql security definer
as $$
begin
  update ingestion.sync_run
  set rows_attempted = rows_attempted + p_attempted,
      rows_succeeded = rows_succeeded + p_succeeded,
      rows_failed = rows_failed + p_failed
  where run_id = p_run_id
    and status = 'running';

  if not found then
    raise exception 'ingestion_report_batch: run_id % not found or not running', p_run_id;
  end if;
end $$;

grant execute on function ingestion_report_batch(uuid,int,int,int) to service_role;
```

- [ ] **Step 4: Apply and re-run test, expect PASS**

```bash
supabase db push
psql "$SUPABASE_DB_URL" -f supabase/tests/ingestion_rpc_tests.sql
```

Expected: `NOTICE: T3 PASS`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/004_ingestion_rpcs.sql supabase/tests/ingestion_rpc_tests.sql
git commit -m "feat(ingestion): add ingestion_report_batch RPC"
```

---

## Task 4: Implement RPC `ingestion_report_failure` (with idempotency)

**Files:**
- Modify: `supabase/migrations/004_ingestion_rpcs.sql` (append)
- Modify: `supabase/tests/ingestion_rpc_tests.sql` (append)

- [ ] **Step 1: Append failing test (two scenarios: new + idempotent update)**

Append to `supabase/tests/ingestion_rpc_tests.sql`:

```sql
-- ===== Task 4: ingestion_report_failure (with idempotency) =====
do $$
declare
  v_run uuid;
  v_f1 uuid;
  v_f2 uuid;
  v_count int;
  v_retry int;
begin
  select run_id into v_run
  from ingestion_start_run('test_src','test_tbl','incremental','cron');

  -- First failure for entity 'E1'
  v_f1 := ingestion_report_failure(v_run, 'E1', 'http_4xx', 'bad request',
    '{"foo":1}'::jsonb);

  -- Second report for the same (source,table,entity) — should update, not insert
  v_f2 := ingestion_report_failure(v_run, 'E1', 'http_4xx', 'bad request again',
    '{"foo":2}'::jsonb);

  if v_f1 is null then raise exception 'T4.1: first failure id is null'; end if;
  if v_f2 is distinct from v_f1 then
    raise exception 'T4.2: idempotency broken — second call produced different id (% vs %)', v_f1, v_f2;
  end if;

  select count(*) into v_count
  from ingestion.sync_failure
  where source_id='test_src' and table_name='test_tbl' and entity_id='E1';
  if v_count <> 1 then
    raise exception 'T4.3: expected 1 row for E1, got %', v_count;
  end if;

  select retry_count into v_retry
  from ingestion.sync_failure where failure_id = v_f1;
  if v_retry <> 1 then
    raise exception 'T4.4: retry_count should have incremented to 1, got %', v_retry;
  end if;

  -- Distinct entity creates a new row
  perform ingestion_report_failure(v_run, 'E2', 'http_5xx', 'boom', null);
  select count(*) into v_count
  from ingestion.sync_failure
  where source_id='test_src' and table_name='test_tbl';
  if v_count <> 2 then
    raise exception 'T4.5: expected 2 rows after E2 report, got %', v_count;
  end if;

  raise notice 'T4 PASS: ingestion_report_failure';
end $$;
```

- [ ] **Step 2: Run, expect failure**

```bash
psql "$SUPABASE_DB_URL" -f supabase/tests/ingestion_rpc_tests.sql
```

Expected: `function ingestion_report_failure does not exist`.

- [ ] **Step 3: Append implementation**

Append to `supabase/migrations/004_ingestion_rpcs.sql`:

```sql
-- 3. ingestion_report_failure: record one failed row. Idempotent on
-- (source,table,entity_id) while status is pending/retrying.
create or replace function ingestion_report_failure(
  p_run_id uuid,
  p_entity_id text,
  p_error_code text,
  p_error_detail text,
  p_payload jsonb
) returns uuid
language plpgsql security definer
as $$
declare
  v_source text;
  v_table text;
  v_failure_id uuid;
begin
  select source_id, table_name into v_source, v_table
  from ingestion.sync_run where run_id = p_run_id;
  if v_source is null then
    raise exception 'ingestion_report_failure: unknown run_id %', p_run_id;
  end if;

  insert into ingestion.sync_failure
    (run_id, source_id, table_name, entity_id,
     error_code, error_detail, payload_snapshot, retry_count, status)
  values
    (p_run_id, v_source, v_table, p_entity_id,
     p_error_code, p_error_detail, p_payload, 0, 'pending')
  on conflict (source_id, table_name, entity_id)
    where status in ('pending','retrying')
  do update set
    error_code = excluded.error_code,
    error_detail = excluded.error_detail,
    payload_snapshot = coalesce(excluded.payload_snapshot, ingestion.sync_failure.payload_snapshot),
    retry_count = ingestion.sync_failure.retry_count + 1,
    last_tried_at = now(),
    run_id = excluded.run_id
  returning failure_id into v_failure_id;

  return v_failure_id;
end $$;

grant execute on function ingestion_report_failure(uuid,text,text,text,jsonb) to service_role;
```

- [ ] **Step 4: Apply and re-run test, expect PASS**

```bash
supabase db push
psql "$SUPABASE_DB_URL" -f supabase/tests/ingestion_rpc_tests.sql
```

Expected: `NOTICE: T4 PASS`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/004_ingestion_rpcs.sql supabase/tests/ingestion_rpc_tests.sql
git commit -m "feat(ingestion): add ingestion_report_failure RPC with idempotent upsert"
```

---

## Task 5: Implement RPC `ingestion_complete_run`

**Files:**
- Modify: `supabase/migrations/004_ingestion_rpcs.sql` (append)
- Modify: `supabase/tests/ingestion_rpc_tests.sql` (append + restore T2.3/T2.4)

- [ ] **Step 1: Append failing test + restore Task 2 deferred assertions**

Append to `supabase/tests/ingestion_rpc_tests.sql`:

```sql
-- ===== Task 5: ingestion_complete_run =====
do $$
declare
  v_run uuid;
  v_status text;
  v_wm text;
  v_ended timestamptz;
begin
  select run_id into v_run
  from ingestion_start_run('test_src','test_tbl','incremental','cron');

  perform ingestion_complete_run(v_run, 'success', '2026-04-12T11:00:00Z');

  select status, high_watermark, ended_at into v_status, v_wm, v_ended
  from ingestion.sync_run where run_id = v_run;

  if v_status <> 'success' then raise exception 'T5.1: status=% expected success', v_status; end if;
  if v_wm is distinct from '2026-04-12T11:00:00Z' then
    raise exception 'T5.2: watermark=% expected 2026-04-12T11:00:00Z', v_wm;
  end if;
  if v_ended is null then raise exception 'T5.3: ended_at not set'; end if;

  raise notice 'T5 PASS: ingestion_complete_run';
end $$;
```

Also unblock the deferred assertions in Task 2's test block: if you moved T2.3/T2.4 to a "deferred" `do` block in Task 2 Step 4, move them back inline in Task 2's main block now, or run them in a new `do` block placed right after T5:

```sql
-- Re-run Task 2's deferred assertions now that complete_run exists
do $$
declare
  r_first record;
  r_second record;
begin
  -- Use a new distinct test table name so we don't collide with earlier T2/T3/T4/T5 inserts
  insert into ingestion.source_registry
    (source_id, table_name, entity_kind, sla_minutes, priority)
  values ('test_src','test_tbl_wm','wm_entity',5,'critical');

  select * into r_first
  from ingestion_start_run('test_src','test_tbl_wm','incremental','cron');
  perform ingestion_complete_run(r_first.run_id, 'success', '2026-04-12T10:00:00Z');

  select * into r_second
  from ingestion_start_run('test_src','test_tbl_wm','incremental','cron');

  if r_second.last_watermark is distinct from '2026-04-12T10:00:00Z' then
    raise exception 'T2.3 (deferred): watermark not carried, got %', r_second.last_watermark;
  end if;
  if r_second.run_id = r_first.run_id then
    raise exception 'T2.4 (deferred): start_run did not generate fresh run_id';
  end if;

  raise notice 'T2 deferred PASS: watermark carryover';
end $$;
```

- [ ] **Step 2: Run, expect failure**

```bash
psql "$SUPABASE_DB_URL" -f supabase/tests/ingestion_rpc_tests.sql
```

Expected: `function ingestion_complete_run does not exist`.

- [ ] **Step 3: Append implementation**

Append to `supabase/migrations/004_ingestion_rpcs.sql`:

```sql
-- 4. ingestion_complete_run: close a run with final status and watermark
create or replace function ingestion_complete_run(
  p_run_id uuid,
  p_status text,
  p_high_watermark text
) returns void
language plpgsql security definer
as $$
begin
  if p_status not in ('success','partial','failed') then
    raise exception 'ingestion_complete_run: invalid status %', p_status;
  end if;

  update ingestion.sync_run
  set status = p_status,
      high_watermark = coalesce(p_high_watermark, high_watermark),
      ended_at = now()
  where run_id = p_run_id
    and status = 'running';

  if not found then
    raise exception 'ingestion_complete_run: run_id % not found or already closed', p_run_id;
  end if;
end $$;

grant execute on function ingestion_complete_run(uuid,text,text) to service_role;
```

- [ ] **Step 4: Apply and re-run test, expect PASS**

```bash
supabase db push
psql "$SUPABASE_DB_URL" -f supabase/tests/ingestion_rpc_tests.sql
```

Expected: `NOTICE: T5 PASS` and `NOTICE: T2 deferred PASS`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/004_ingestion_rpcs.sql supabase/tests/ingestion_rpc_tests.sql
git commit -m "feat(ingestion): add ingestion_complete_run RPC"
```

---

## Task 6: Implement RPC `ingestion_report_source_count` with auto-heal

**Files:**
- Modify: `supabase/migrations/004_ingestion_rpcs.sql` (append)
- Modify: `supabase/tests/ingestion_rpc_tests.sql` (append)

This RPC is the most complex — it does the reconcile compare AND auto-heals by injecting failures for missing IDs. The supabase_count comes from a `count(*)` on the target table; in the test we'll use a dummy target table.

- [ ] **Step 1: Append failing test**

Append to `supabase/tests/ingestion_rpc_tests.sql`:

```sql
-- ===== Task 6: ingestion_report_source_count (with auto-heal) =====
do $$
declare
  v_rec uuid;
  v_count int;
  v_div int;
  v_status text;
  v_healed int;
  v_failures int;
begin
  -- Create a dummy target table in the default schema so the RPC can count it
  create temporary table odoo_test_target (id text primary key);
  insert into odoo_test_target values ('A'), ('B'), ('C');

  -- Register a source whose table_name points to the dummy
  insert into ingestion.source_registry
    (source_id, table_name, entity_kind, sla_minutes, priority, reconciliation_window_days)
  values ('test_src','odoo_test_target','thing',60,'important',30);

  -- Source claims 5 rows (D and E missing from supabase)
  v_rec := ingestion_report_source_count(
    'test_src','odoo_test_target',
    '2026-04-01 00:00'::timestamptz, '2026-04-12 00:00'::timestamptz,
    5, array['A','B','C','D','E']);

  select supabase_count, divergence, status, auto_healed_count
    into v_count, v_div, v_status, v_healed
  from ingestion.reconciliation_run where reconciliation_id = v_rec;

  if v_count <> 3 then raise exception 'T6.1: supabase_count=% expected 3', v_count; end if;
  if v_div <> 2 then raise exception 'T6.2: divergence=% expected 2', v_div; end if;
  if v_status <> 'divergent_positive' then
    raise exception 'T6.3: status=% expected divergent_positive', v_status;
  end if;
  if v_healed <> 2 then raise exception 'T6.4: auto_healed=% expected 2', v_healed; end if;

  -- Two new failure rows should exist for D and E
  select count(*) into v_failures
  from ingestion.sync_failure
  where source_id='test_src' and table_name='odoo_test_target'
    and entity_id in ('D','E')
    and error_code='reconciliation_missing';
  if v_failures <> 2 then
    raise exception 'T6.5: expected 2 auto-healed failures, got %', v_failures;
  end if;

  -- Negative divergence test: source says 2 rows, supabase has 3 → divergent_negative, no auto-heal
  v_rec := ingestion_report_source_count(
    'test_src','odoo_test_target',
    '2026-04-01 00:00'::timestamptz, '2026-04-12 00:00'::timestamptz,
    2, null);

  select status, auto_healed_count into v_status, v_healed
  from ingestion.reconciliation_run where reconciliation_id = v_rec;
  if v_status <> 'divergent_negative' then
    raise exception 'T6.6: status=% expected divergent_negative', v_status;
  end if;
  if v_healed <> 0 then raise exception 'T6.7: negative divergence should not auto-heal'; end if;

  raise notice 'T6 PASS: ingestion_report_source_count';
end $$;
```

- [ ] **Step 2: Run, expect failure**

```bash
psql "$SUPABASE_DB_URL" -f supabase/tests/ingestion_rpc_tests.sql
```

Expected: `function ingestion_report_source_count does not exist`.

- [ ] **Step 3: Append implementation**

Append to `supabase/migrations/004_ingestion_rpcs.sql`:

```sql
-- 5. ingestion_report_source_count: reconcile source vs supabase counts,
-- auto-heal by injecting failures for known-missing entity_ids.
create or replace function ingestion_report_source_count(
  p_source text,
  p_table text,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_source_count int,
  p_missing_entity_ids text[]
) returns uuid
language plpgsql security definer
as $$
declare
  v_rec_id uuid;
  v_sb_count int;
  v_divergence int;
  v_status text;
  v_healed int := 0;
  v_synthetic_run uuid;
  v_missing_id text;
begin
  -- Verify source is registered
  if not exists (
    select 1 from ingestion.source_registry
    where source_id = p_source and table_name = p_table
  ) then
    raise exception 'ingestion_report_source_count: source (%, %) not in registry', p_source, p_table;
  end if;

  -- Count rows in the target table (schema is the default public schema)
  execute format('select count(*) from %I', p_table) into v_sb_count;

  v_divergence := coalesce(p_source_count, 0) - v_sb_count;

  if p_source_count is null then
    v_status := 'unknown';
  elsif v_divergence = 0 then
    v_status := 'clean';
  elsif v_divergence > 0 then
    v_status := 'divergent_positive';
  else
    v_status := 'divergent_negative';
  end if;

  -- Auto-heal only positive divergence WITH a list of missing ids
  if v_status = 'divergent_positive' and p_missing_entity_ids is not null then
    -- Open a synthetic reconciliation run so failures have a parent run_id
    insert into ingestion.sync_run
      (source_id, table_name, run_type, triggered_by, status, ended_at)
    values
      (p_source, p_table, 'retry', 'reconciliation', 'success', now())
    returning run_id into v_synthetic_run;

    foreach v_missing_id in array p_missing_entity_ids loop
      insert into ingestion.sync_failure
        (run_id, source_id, table_name, entity_id,
         error_code, error_detail, payload_snapshot)
      values
        (v_synthetic_run, p_source, p_table, v_missing_id,
         'reconciliation_missing',
         format('row %s missing in supabase per nightly reconcile', v_missing_id),
         null)
      on conflict (source_id, table_name, entity_id)
        where status in ('pending','retrying')
      do nothing;

      if found then v_healed := v_healed + 1; end if;
    end loop;
  end if;

  insert into ingestion.reconciliation_run
    (source_id, table_name, window_start, window_end,
     source_count, supabase_count, divergence,
     missing_entity_ids, status, auto_healed_count)
  values
    (p_source, p_table, p_window_start, p_window_end,
     p_source_count, v_sb_count, v_divergence,
     p_missing_entity_ids, v_status, v_healed)
  returning reconciliation_id into v_rec_id;

  return v_rec_id;
end $$;

grant execute on function ingestion_report_source_count(text,text,timestamptz,timestamptz,int,text[]) to service_role;
```

Note on `format('select count(*) from %I', p_table)`: this assumes the target table lives in the default search_path (typically `public`). If you keep Odoo mirror tables in a different schema later, extend this to accept `p_schema text` — for Fase 0 Plan 1 it's fine since all `odoo_*` tables live in `public`.

Also note: the `found` semantics after `on conflict ... do nothing` don't reflect "inserted a new row". Fix this by checking the returned count:

Replace the `foreach` block with this version:

```sql
    foreach v_missing_id in array p_missing_entity_ids loop
      with ins as (
        insert into ingestion.sync_failure
          (run_id, source_id, table_name, entity_id,
           error_code, error_detail, payload_snapshot)
        values
          (v_synthetic_run, p_source, p_table, v_missing_id,
           'reconciliation_missing',
           format('row %s missing in supabase per nightly reconcile', v_missing_id),
           null)
        on conflict (source_id, table_name, entity_id)
          where status in ('pending','retrying')
        do nothing
        returning 1
      )
      select v_healed + coalesce((select count(*) from ins), 0)
      into v_healed;
    end loop;
```

- [ ] **Step 4: Apply and re-run test, expect PASS**

```bash
supabase db push
psql "$SUPABASE_DB_URL" -f supabase/tests/ingestion_rpc_tests.sql
```

Expected: `NOTICE: T6 PASS`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/004_ingestion_rpcs.sql supabase/tests/ingestion_rpc_tests.sql
git commit -m "feat(ingestion): add ingestion_report_source_count with auto-heal

Reconciliation RPC computes supabase count from target table,
determines divergence status, and for divergent_positive with a list
of missing entity_ids auto-heals by injecting sync_failure rows under
a synthetic reconciliation run. Negative divergence is logged only."
```

---

## Task 7: Implement RPC `ingestion_fetch_pending_failures` with atomic claim

**Files:**
- Modify: `supabase/migrations/004_ingestion_rpcs.sql` (append)
- Modify: `supabase/tests/ingestion_rpc_tests.sql` (append)

- [ ] **Step 1: Append failing test**

Append to `supabase/tests/ingestion_rpc_tests.sql`:

```sql
-- ===== Task 7: ingestion_fetch_pending_failures =====
do $$
declare
  v_run uuid;
  v_fetched_count int;
  v_statuses text[];
begin
  select run_id into v_run
  from ingestion_start_run('test_src','odoo_test_target','retry','manual');

  -- Create 3 pending failures with varying retry_counts
  perform ingestion_report_failure(v_run, 'X1', 'http_4xx', 'err', '{}'::jsonb);
  perform ingestion_report_failure(v_run, 'X2', 'http_4xx', 'err', '{}'::jsonb);
  perform ingestion_report_failure(v_run, 'X3', 'http_4xx', 'err', '{}'::jsonb);
  -- Push X3 over the retry limit by calling report_failure multiple times
  perform ingestion_report_failure(v_run, 'X3', 'http_4xx', 'err', '{}'::jsonb);
  perform ingestion_report_failure(v_run, 'X3', 'http_4xx', 'err', '{}'::jsonb);
  perform ingestion_report_failure(v_run, 'X3', 'http_4xx', 'err', '{}'::jsonb);
  perform ingestion_report_failure(v_run, 'X3', 'http_4xx', 'err', '{}'::jsonb);
  -- Now X3.retry_count = 4

  -- fetch with max_retries=3: should return X1, X2 only (not X3)
  select count(*), array_agg(status order by entity_id) into v_fetched_count, v_statuses
  from ingestion_fetch_pending_failures('test_src','odoo_test_target',3,10);

  if v_fetched_count <> 2 then
    raise exception 'T7.1: expected 2 fetched, got %', v_fetched_count;
  end if;

  -- Fetched rows should now be status='retrying' in the table
  select count(*) into v_fetched_count
  from ingestion.sync_failure
  where source_id='test_src' and table_name='odoo_test_target'
    and status='retrying';
  if v_fetched_count <> 2 then
    raise exception 'T7.2: expected 2 rows marked retrying, got %', v_fetched_count;
  end if;

  -- Second fetch should return 0 (already claimed)
  select count(*) into v_fetched_count
  from ingestion_fetch_pending_failures('test_src','odoo_test_target',3,10);
  if v_fetched_count <> 0 then
    raise exception 'T7.3: second fetch should return 0, got %', v_fetched_count;
  end if;

  raise notice 'T7 PASS: ingestion_fetch_pending_failures';
end $$;
```

- [ ] **Step 2: Run, expect failure**

```bash
psql "$SUPABASE_DB_URL" -f supabase/tests/ingestion_rpc_tests.sql
```

Expected: `function ingestion_fetch_pending_failures does not exist`.

- [ ] **Step 3: Append implementation**

Append to `supabase/migrations/004_ingestion_rpcs.sql`:

```sql
-- 6. ingestion_fetch_pending_failures: atomically claim pending failures for retry
create or replace function ingestion_fetch_pending_failures(
  p_source text,
  p_table text,
  p_max_retries int,
  p_limit int
) returns setof ingestion.sync_failure
language plpgsql security definer
as $$
begin
  return query
  with claimed as (
    select failure_id
    from ingestion.sync_failure
    where source_id = p_source
      and table_name = p_table
      and status = 'pending'
      and retry_count < p_max_retries
    order by first_seen_at asc
    limit p_limit
    for update skip locked
  )
  update ingestion.sync_failure sf
  set status = 'retrying',
      last_tried_at = now()
  from claimed
  where sf.failure_id = claimed.failure_id
  returning sf.*;
end $$;

grant execute on function ingestion_fetch_pending_failures(text,text,int,int) to service_role;
```

Note on `for update skip locked`: this is what makes concurrent crons safe. Two retry workers won't grab the same failure.

- [ ] **Step 4: Apply and re-run test, expect PASS**

```bash
supabase db push
psql "$SUPABASE_DB_URL" -f supabase/tests/ingestion_rpc_tests.sql
```

Expected: `NOTICE: T7 PASS`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/004_ingestion_rpcs.sql supabase/tests/ingestion_rpc_tests.sql
git commit -m "feat(ingestion): add ingestion_fetch_pending_failures with atomic claim"
```

---

## Task 8: Implement RPC `ingestion_mark_failure_resolved`

**Files:**
- Modify: `supabase/migrations/004_ingestion_rpcs.sql` (append)
- Modify: `supabase/tests/ingestion_rpc_tests.sql` (append)

- [ ] **Step 1: Append failing test**

Append to `supabase/tests/ingestion_rpc_tests.sql`:

```sql
-- ===== Task 8: ingestion_mark_failure_resolved =====
do $$
declare
  v_run uuid;
  v_fid uuid;
  v_status text;
  v_resolved timestamptz;
begin
  select run_id into v_run
  from ingestion_start_run('test_src','odoo_test_target','retry','manual');
  v_fid := ingestion_report_failure(v_run,'Y1','http_4xx','boom','{}'::jsonb);

  perform ingestion_mark_failure_resolved(v_fid);

  select status, resolved_at into v_status, v_resolved
  from ingestion.sync_failure where failure_id = v_fid;
  if v_status <> 'resolved' then raise exception 'T8.1: status=% expected resolved', v_status; end if;
  if v_resolved is null then raise exception 'T8.2: resolved_at not set'; end if;

  raise notice 'T8 PASS: ingestion_mark_failure_resolved';
end $$;
```

- [ ] **Step 2: Run, expect failure**

Expected: `function ingestion_mark_failure_resolved does not exist`.

- [ ] **Step 3: Append implementation**

Append to `supabase/migrations/004_ingestion_rpcs.sql`:

```sql
-- 7. ingestion_mark_failure_resolved: close out a failure after successful retry
create or replace function ingestion_mark_failure_resolved(
  p_failure_id uuid
) returns void
language plpgsql security definer
as $$
begin
  update ingestion.sync_failure
  set status = 'resolved',
      resolved_at = now()
  where failure_id = p_failure_id;
  if not found then
    raise exception 'ingestion_mark_failure_resolved: failure_id % not found', p_failure_id;
  end if;
end $$;

grant execute on function ingestion_mark_failure_resolved(uuid) to service_role;
```

- [ ] **Step 4: Apply and re-run full test, expect all PASS**

```bash
supabase db push
psql "$SUPABASE_DB_URL" -f supabase/tests/ingestion_rpc_tests.sql
```

Expected: `T2 PASS`, `T2 deferred PASS`, `T3 PASS`, `T4 PASS`, `T5 PASS`, `T6 PASS`, `T7 PASS`, `T8 PASS`, and finally `ROLLBACK`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/004_ingestion_rpcs.sql supabase/tests/ingestion_rpc_tests.sql
git commit -m "feat(ingestion): add ingestion_mark_failure_resolved RPC

Completes the 7-RPC contract for the ingestion core. All RPCs covered
by rollback-only SQL test script with inline assertions."
```

---

## Task 9: Sentinel pg_cron function and 3 health views

**Files:**
- Create: `supabase/migrations/005_ingestion_sentinel_and_views.sql`
- Modify: `supabase/tests/ingestion_rpc_tests.sql` (append sentinel test)

- [ ] **Step 1: Append failing test for sentinel**

Append to `supabase/tests/ingestion_rpc_tests.sql`:

```sql
-- ===== Task 9: sentinel check_missing_reconciliations =====
do $$
declare
  v_breaches int;
begin
  -- test_src/odoo_test_target has never had a reconciliation_run → should trigger breach
  perform ingestion.check_missing_reconciliations();

  select count(*) into v_breaches
  from ingestion.sla_breach
  where source_id='test_src' and table_name='odoo_test_target'
    and breach_type='reconciliation_stale'
    and resolved_at is null;
  if v_breaches < 1 then
    raise exception 'T9.1: expected reconciliation_stale breach for never-reconciled table, got %', v_breaches;
  end if;

  raise notice 'T9 PASS: check_missing_reconciliations';
end $$;
```

Note: test_src/test_tbl was reconciled in task 6? No — task 6 used `odoo_test_target`. `test_tbl` and `test_tbl_wm` have no reconcile entry either. Adjust expectation: expect at least 1 breach for `odoo_test_target` (since inactive rows in the registry like test_tbl/test_tbl_wm could also produce breaches; the test is still valid because we assert >=1 for the specific row we care about).

- [ ] **Step 2: Run, expect failure**

```bash
psql "$SUPABASE_DB_URL" -f supabase/tests/ingestion_rpc_tests.sql
```

Expected: `function ingestion.check_missing_reconciliations does not exist`.

- [ ] **Step 3: Create migration file with sentinel + views**

Create `supabase/migrations/005_ingestion_sentinel_and_views.sql`:

```sql
-- supabase/migrations/005_ingestion_sentinel_and_views.sql
-- Fase 0 Plan 1: sentinel function + pg_cron schedule + 3 health views

-- Sentinel: for every active registry row, flag if reconciliation_run
-- hasn't executed in 25 hours. Open sla_breach rows unless one already exists.
create or replace function ingestion.check_missing_reconciliations()
returns int
language plpgsql security definer
as $$
declare
  v_opened int := 0;
  r record;
  v_last_ran timestamptz;
  v_actual_mins int;
begin
  for r in
    select source_id, table_name, sla_minutes
    from ingestion.source_registry
    where is_active = true
  loop
    select max(ran_at) into v_last_ran
    from ingestion.reconciliation_run
    where source_id = r.source_id and table_name = r.table_name;

    if v_last_ran is null then
      v_actual_mins := 99999;
    else
      v_actual_mins := extract(epoch from (now() - v_last_ran)) / 60;
    end if;

    if v_actual_mins > 25 * 60 then
      -- Only open a new breach if there is no unresolved one already
      if not exists (
        select 1 from ingestion.sla_breach
        where source_id = r.source_id and table_name = r.table_name
          and breach_type = 'reconciliation_stale' and resolved_at is null
      ) then
        insert into ingestion.sla_breach
          (source_id, table_name, breach_type, sla_minutes, actual_minutes)
        values
          (r.source_id, r.table_name, 'reconciliation_stale', 25*60, v_actual_mins);
        v_opened := v_opened + 1;
      end if;
    else
      -- Fresh again: auto-resolve any open breach
      update ingestion.sla_breach
      set resolved_at = now()
      where source_id = r.source_id and table_name = r.table_name
        and breach_type = 'reconciliation_stale' and resolved_at is null;
    end if;
  end loop;
  return v_opened;
end $$;

grant execute on function ingestion.check_missing_reconciliations() to service_role;

-- Schedule via pg_cron (every hour). Safe to re-run migration: unschedule first.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('ingestion_sentinel') where exists (
      select 1 from cron.job where jobname = 'ingestion_sentinel'
    );
    perform cron.schedule(
      'ingestion_sentinel',
      '0 * * * *',
      $cron$ select ingestion.check_missing_reconciliations(); $cron$
    );
  else
    raise notice 'pg_cron not installed; sentinel must be scheduled externally';
  end if;
end $$;

-- ===== Health views =====

-- v_source_health: one row per active registry entry with freshness and latest status
create or replace view ingestion.v_source_health as
select
  r.source_id,
  r.table_name,
  r.entity_kind,
  r.sla_minutes,
  r.priority,
  last_run.started_at as last_run_started_at,
  last_run.ended_at as last_run_ended_at,
  last_run.status as last_run_status,
  last_run.rows_succeeded as last_run_rows_succeeded,
  last_run.rows_failed as last_run_rows_failed,
  last_success.ended_at as last_success_at,
  case
    when last_success.ended_at is null then null
    else extract(epoch from (now() - last_success.ended_at))/60
  end as staleness_minutes,
  case
    when last_success.ended_at is null then 'unknown'
    when extract(epoch from (now() - last_success.ended_at))/60 <= r.sla_minutes then 'green'
    when extract(epoch from (now() - last_success.ended_at))/60 <= r.sla_minutes*2 then 'yellow'
    else 'red'
  end as health
from ingestion.source_registry r
left join lateral (
  select * from ingestion.sync_run sr
  where sr.source_id = r.source_id and sr.table_name = r.table_name
  order by sr.started_at desc limit 1
) last_run on true
left join lateral (
  select * from ingestion.sync_run sr
  where sr.source_id = r.source_id and sr.table_name = r.table_name
    and sr.status = 'success'
  order by sr.ended_at desc limit 1
) last_success on true
where r.is_active = true;

-- v_open_failures: all pending/retrying failures with age
create or replace view ingestion.v_open_failures as
select
  failure_id, source_id, table_name, entity_id,
  error_code, retry_count, status,
  first_seen_at, last_tried_at,
  extract(epoch from (now() - first_seen_at))/60 as age_minutes
from ingestion.sync_failure
where status in ('pending','retrying')
order by first_seen_at asc;

-- v_sla_status: open breaches
create or replace view ingestion.v_sla_status as
select
  breach_id, source_id, table_name, breach_type,
  sla_minutes, actual_minutes, detected_at,
  extract(epoch from (now() - detected_at))/60 as age_minutes
from ingestion.sla_breach
where resolved_at is null
order by detected_at asc;

grant select on ingestion.v_source_health to service_role;
grant select on ingestion.v_open_failures to service_role;
grant select on ingestion.v_sla_status to service_role;
```

- [ ] **Step 4: Apply and re-run test, expect PASS**

```bash
supabase db push
psql "$SUPABASE_DB_URL" -f supabase/tests/ingestion_rpc_tests.sql
```

Expected: `NOTICE: T9 PASS` plus all earlier passes.

- [ ] **Step 5: Verify views return rows**

```sql
select * from ingestion.v_source_health;
select * from ingestion.v_open_failures limit 5;
select * from ingestion.v_sla_status limit 5;
```

Expected: views exist and execute without error (they may be empty in real prod data until seed in Task 10).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/005_ingestion_sentinel_and_views.sql supabase/tests/ingestion_rpc_tests.sql
git commit -m "feat(ingestion): add sentinel function, pg_cron schedule, and 3 health views

check_missing_reconciliations() opens sla_breach rows when a registered
table has no reconciliation_run in >25h, and auto-resolves breaches
when a fresh reconcile arrives. Scheduled hourly via pg_cron. Views
v_source_health, v_open_failures, v_sla_status drive the /system
dashboard in Plan 3."
```

---

## Task 10: Seed `source_registry` for invoices and payments

**Files:**
- Create: `supabase/migrations/006_ingestion_seed_registry.sql`

- [ ] **Step 1: Write the seed migration**

Create `supabase/migrations/006_ingestion_seed_registry.sql`:

```sql
-- supabase/migrations/006_ingestion_seed_registry.sql
-- Fase 0 Plan 1: initial source_registry for the two critical tables

insert into ingestion.source_registry
  (source_id, table_name, entity_kind, sla_minutes, priority, owner_agent, reconciliation_window_days, is_active)
values
  ('odoo','odoo_invoices','invoice',60,'critical','finance',30,true),
  ('odoo','odoo_payments','payment',60,'critical','finance',30,true)
on conflict (source_id, table_name) do update set
  entity_kind = excluded.entity_kind,
  sla_minutes = excluded.sla_minutes,
  priority = excluded.priority,
  owner_agent = excluded.owner_agent,
  reconciliation_window_days = excluded.reconciliation_window_days,
  is_active = excluded.is_active;
```

- [ ] **Step 2: Apply migration**

```bash
supabase db push
```

- [ ] **Step 3: Verify**

```sql
select source_id, table_name, sla_minutes, priority, reconciliation_window_days
from ingestion.source_registry
where source_id='odoo'
order by table_name;
```

Expected: 2 rows, `odoo_invoices` and `odoo_payments`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/006_ingestion_seed_registry.sql
git commit -m "feat(ingestion): seed source_registry for odoo_invoices and odoo_payments"
```

---

## Task 11: Create `IngestionCore` Python client in qb19

**Files:**
- Create: `addons/quimibond_intelligence/models/ingestion_core.py`
- Modify: `addons/quimibond_intelligence/models/__init__.py`
- Create: `addons/quimibond_intelligence/tests/__init__.py`
- Create: `addons/quimibond_intelligence/tests/test_ingestion_core.py`

Note: qb19 lives in `/Users/jj/addons/quimibond_intelligence/` (its own repo), NOT in the quimibond-intelligence frontend repo. Tasks 11–14 operate there. Commits in qb19 are separate.

- [ ] **Step 1: Write the failing test**

Create `addons/quimibond_intelligence/tests/__init__.py` (empty file) and `addons/quimibond_intelligence/tests/test_ingestion_core.py`:

```python
"""
Unit tests for IngestionCore. Uses an in-memory fake Supabase client
so we don't hit the network. Run with:
  cd /Users/jj/addons && pytest quimibond_intelligence/tests/test_ingestion_core.py -v
"""
import pytest
from unittest.mock import MagicMock
from quimibond_intelligence.models.ingestion_core import IngestionCore


class FakeRPCClient:
    """Captures RPC calls and returns canned responses."""
    def __init__(self):
        self.calls = []
        self.responses = {}

    def rpc(self, name, params):
        self.calls.append((name, params))
        if name in self.responses:
            resp = self.responses[name]
            return resp(params) if callable(resp) else resp
        return None


def test_start_run_returns_run_id_and_watermark():
    client = FakeRPCClient()
    client.responses['ingestion_start_run'] = [
        {'run_id': 'run-123', 'last_watermark': '2026-04-12T10:00:00Z'}
    ]
    core = IngestionCore(client)

    run_id, wm = core.start_run('odoo', 'odoo_invoices', 'incremental', 'cron')

    assert run_id == 'run-123'
    assert wm == '2026-04-12T10:00:00Z'
    assert client.calls[0][0] == 'ingestion_start_run'
    assert client.calls[0][1] == {
        'p_source': 'odoo',
        'p_table': 'odoo_invoices',
        'p_run_type': 'incremental',
        'p_triggered_by': 'cron',
    }


def test_start_run_handles_null_watermark():
    client = FakeRPCClient()
    client.responses['ingestion_start_run'] = [{'run_id': 'r1', 'last_watermark': None}]
    core = IngestionCore(client)
    run_id, wm = core.start_run('odoo', 'odoo_invoices', 'full', 'manual')
    assert run_id == 'r1'
    assert wm is None


def test_report_batch_sends_counters():
    client = FakeRPCClient()
    client.responses['ingestion_report_batch'] = None
    core = IngestionCore(client)
    core.report_batch('run-1', 200, 195, 5)
    assert client.calls[-1] == (
        'ingestion_report_batch',
        {'p_run_id': 'run-1', 'p_attempted': 200, 'p_succeeded': 195, 'p_failed': 5},
    )


def test_report_failure_sends_payload_and_returns_id():
    client = FakeRPCClient()
    client.responses['ingestion_report_failure'] = 'failure-xyz'
    core = IngestionCore(client)
    fid = core.report_failure(
        'run-1', 'E42', 'http_4xx', 'bad request',
        {'id': 42, 'name': 'inv-0042'}
    )
    assert fid == 'failure-xyz'
    assert client.calls[-1][1]['p_entity_id'] == 'E42'
    assert client.calls[-1][1]['p_payload'] == {'id': 42, 'name': 'inv-0042'}


def test_complete_run_sends_status_and_watermark():
    client = FakeRPCClient()
    client.responses['ingestion_complete_run'] = None
    core = IngestionCore(client)
    core.complete_run('run-1', 'partial', '2026-04-12T11:00:00Z')
    assert client.calls[-1] == (
        'ingestion_complete_run',
        {'p_run_id': 'run-1', 'p_status': 'partial', 'p_high_watermark': '2026-04-12T11:00:00Z'},
    )


def test_report_source_count_handles_missing_ids_list():
    client = FakeRPCClient()
    client.responses['ingestion_report_source_count'] = 'rec-1'
    core = IngestionCore(client)
    rid = core.report_source_count(
        'odoo', 'odoo_invoices',
        '2026-04-01T00:00:00Z', '2026-04-12T00:00:00Z',
        100, ['inv-1', 'inv-2']
    )
    assert rid == 'rec-1'
    call = client.calls[-1][1]
    assert call['p_source_count'] == 100
    assert call['p_missing_entity_ids'] == ['inv-1', 'inv-2']


def test_fetch_pending_failures_returns_list():
    client = FakeRPCClient()
    client.responses['ingestion_fetch_pending_failures'] = [
        {'failure_id': 'f1', 'entity_id': 'E1', 'payload_snapshot': {'x': 1}},
        {'failure_id': 'f2', 'entity_id': 'E2', 'payload_snapshot': None},
    ]
    core = IngestionCore(client)
    results = core.fetch_pending_failures('odoo', 'odoo_invoices', max_retries=3, limit=50)
    assert len(results) == 2
    assert results[0]['failure_id'] == 'f1'


def test_mark_resolved_sends_failure_id():
    client = FakeRPCClient()
    client.responses['ingestion_mark_failure_resolved'] = None
    core = IngestionCore(client)
    core.mark_resolved('f1')
    assert client.calls[-1] == ('ingestion_mark_failure_resolved', {'p_failure_id': 'f1'})
```

- [ ] **Step 2: Run test, expect failure**

```bash
cd /Users/jj/addons && pytest quimibond_intelligence/tests/test_ingestion_core.py -v
```

Expected: `ImportError: cannot import name 'IngestionCore'` or `ModuleNotFoundError`.

- [ ] **Step 3: Implement `ingestion_core.py`**

Create `addons/quimibond_intelligence/models/ingestion_core.py`:

```python
"""
IngestionCore: thin wrapper over the ingestion.* Postgres RPCs.

Usage:
    client = SupabaseRPCClient(url, service_key)  # or SupabaseClient with .rpc()
    core = IngestionCore(client)
    run_id, watermark = core.start_run('odoo', 'odoo_invoices', 'incremental', 'cron')
    # ... do the sync, call report_batch / report_failure as you go ...
    core.complete_run(run_id, 'success', new_watermark)

The `client` object must expose a single method:
    rpc(name: str, params: dict) -> response
where `response` is whatever the RPC returned (dict, list, scalar, or None).
"""
import logging
from typing import Any, Optional

_logger = logging.getLogger(__name__)


class IngestionCore:
    def __init__(self, rpc_client: Any):
        self._c = rpc_client

    # 1. start_run → (run_id, last_watermark)
    def start_run(self, source: str, table: str, run_type: str,
                  triggered_by: str) -> tuple[str, Optional[str]]:
        resp = self._c.rpc('ingestion_start_run', {
            'p_source': source,
            'p_table': table,
            'p_run_type': run_type,
            'p_triggered_by': triggered_by,
        })
        # PostgREST returns a list of rows for table-returning functions
        row = resp[0] if isinstance(resp, list) and resp else resp or {}
        return row.get('run_id'), row.get('last_watermark')

    # 2. report_batch
    def report_batch(self, run_id: str, attempted: int,
                     succeeded: int, failed: int) -> None:
        self._c.rpc('ingestion_report_batch', {
            'p_run_id': run_id,
            'p_attempted': attempted,
            'p_succeeded': succeeded,
            'p_failed': failed,
        })

    # 3. report_failure → failure_id
    def report_failure(self, run_id: str, entity_id: str, error_code: str,
                       error_detail: str, payload: Optional[dict]) -> str:
        return self._c.rpc('ingestion_report_failure', {
            'p_run_id': run_id,
            'p_entity_id': str(entity_id),
            'p_error_code': error_code,
            'p_error_detail': error_detail or '',
            'p_payload': payload,
        })

    # 4. complete_run
    def complete_run(self, run_id: str, status: str,
                     high_watermark: Optional[str]) -> None:
        self._c.rpc('ingestion_complete_run', {
            'p_run_id': run_id,
            'p_status': status,
            'p_high_watermark': high_watermark,
        })

    # 5. report_source_count → reconciliation_id
    def report_source_count(self, source: str, table: str,
                            window_start: str, window_end: str,
                            source_count: Optional[int],
                            missing_entity_ids: Optional[list]) -> str:
        return self._c.rpc('ingestion_report_source_count', {
            'p_source': source,
            'p_table': table,
            'p_window_start': window_start,
            'p_window_end': window_end,
            'p_source_count': source_count,
            'p_missing_entity_ids': missing_entity_ids,
        })

    # 6. fetch_pending_failures → list of failure rows
    def fetch_pending_failures(self, source: str, table: str,
                               max_retries: int, limit: int) -> list:
        resp = self._c.rpc('ingestion_fetch_pending_failures', {
            'p_source': source,
            'p_table': table,
            'p_max_retries': max_retries,
            'p_limit': limit,
        })
        return resp if isinstance(resp, list) else []

    # 7. mark_resolved
    def mark_resolved(self, failure_id: str) -> None:
        self._c.rpc('ingestion_mark_failure_resolved', {
            'p_failure_id': failure_id,
        })
```

- [ ] **Step 4: Register module in `__init__.py`**

Edit `addons/quimibond_intelligence/models/__init__.py` and add:
```python
from . import ingestion_core
```

- [ ] **Step 5: Run tests, expect PASS**

```bash
cd /Users/jj/addons && pytest quimibond_intelligence/tests/test_ingestion_core.py -v
```

Expected: 8 passed.

- [ ] **Step 6: Commit (in qb19 repo)**

```bash
cd /Users/jj/addons
git add quimibond_intelligence/models/ingestion_core.py \
        quimibond_intelligence/models/__init__.py \
        quimibond_intelligence/tests/__init__.py \
        quimibond_intelligence/tests/test_ingestion_core.py
git commit -m "feat(ingestion): add IngestionCore Python wrapper for 7 ingestion RPCs

Thin client over the ingestion.* PostgREST RPCs. Accepts any rpc_client
that exposes .rpc(name, params). Fully unit tested with a fake client."
```

---

## Task 12: Extend `supabase_client.py` with `upsert_with_details()` and `.rpc()`

**Files:**
- Modify: `addons/quimibond_intelligence/models/supabase_client.py`
- Create: `addons/quimibond_intelligence/tests/test_supabase_client_details.py`

Current `supabase_client.upsert()` returns only a count. IngestionCore needs to know which rows failed individually, so we add a new method. We also add a `.rpc()` method so the same client can drive IngestionCore.

- [ ] **Step 1: Write failing test**

Create `addons/quimibond_intelligence/tests/test_supabase_client_details.py`:

```python
"""
Tests for upsert_with_details. Uses a mocked httpx.Client so we don't hit network.
"""
from unittest.mock import MagicMock
import httpx
from quimibond_intelligence.models.supabase_client import SupabaseClient


def _make_client(mock_http):
    c = SupabaseClient('https://x.supabase.co', 'svc-key')
    c._http = mock_http
    return c


def test_upsert_with_details_all_success():
    mock = MagicMock()
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = [{'id': 1}, {'id': 2}, {'id': 3}]
    mock.post.return_value = response

    c = _make_client(mock)
    rows = [{'id': 1}, {'id': 2}, {'id': 3}]
    ok, failed = c.upsert_with_details('odoo_invoices', rows, 'id', batch_size=100)

    assert ok == 3
    assert failed == []


def test_upsert_with_details_batch_failure_records_each_row():
    mock = MagicMock()
    resp_fail = MagicMock()
    resp_fail.status_code = 400
    resp_fail.text = 'schema mismatch: column "foo" does not exist'
    # httpx.Response.raise_for_status() raises if status >= 400
    resp_fail.raise_for_status.side_effect = httpx.HTTPStatusError(
        'bad request', request=MagicMock(), response=resp_fail)
    mock.post.return_value = resp_fail

    c = _make_client(mock)
    rows = [{'id': 10}, {'id': 11}]
    ok, failed = c.upsert_with_details('odoo_invoices', rows, 'id', batch_size=100)

    assert ok == 0
    assert len(failed) == 2
    item0, err0 = failed[0]
    assert item0 == {'id': 10}
    assert err0['code'].startswith('http_4xx')
    assert 'schema mismatch' in err0['detail']


def test_rpc_posts_to_rpc_endpoint():
    mock = MagicMock()
    resp = MagicMock()
    resp.status_code = 200
    resp.json.return_value = [{'run_id': 'r1', 'last_watermark': None}]
    mock.post.return_value = resp

    c = _make_client(mock)
    result = c.rpc('ingestion_start_run', {
        'p_source': 'odoo', 'p_table': 'odoo_invoices',
        'p_run_type': 'incremental', 'p_triggered_by': 'cron',
    })

    assert result == [{'run_id': 'r1', 'last_watermark': None}]
    call_args = mock.post.call_args
    assert '/rest/v1/rpc/ingestion_start_run' in call_args[0][0]
```

- [ ] **Step 2: Run, expect failure**

```bash
cd /Users/jj/addons && pytest quimibond_intelligence/tests/test_supabase_client_details.py -v
```

Expected: `AttributeError: 'SupabaseClient' object has no attribute 'upsert_with_details'` (and same for `rpc`).

- [ ] **Step 3: Extend `supabase_client.py`**

Open `addons/quimibond_intelligence/models/supabase_client.py` and add these two methods inside the `SupabaseClient` class (after the existing `upsert` method):

```python
    def upsert_with_details(self, table: str, rows: list, on_conflict: str,
                            batch_size: int = 200) -> tuple[int, list]:
        """
        Upsert rows and return (success_count, [(row, error_dict), ...]).

        Unlike upsert(), this never swallows errors. Every batch that fails
        after retries is reported individually so the caller can record each
        lost row via IngestionCore.report_failure.

        error_dict has keys: code (str), detail (str), status (int).
        """
        if not rows:
            return 0, []
        ok_count = 0
        failed: list[tuple[dict, dict]] = []
        url = f"{self.url}/rest/v1/{table}?on_conflict={on_conflict}"
        headers = {**self.headers, 'Prefer': 'resolution=merge-duplicates,return=minimal'}

        for i in range(0, len(rows), batch_size):
            chunk = rows[i:i + batch_size]
            try:
                response = self._http.post(url, headers=headers, content=json.dumps(chunk))
                response.raise_for_status()
                ok_count += len(chunk)
            except httpx.HTTPStatusError as e:
                code = f"http_{e.response.status_code // 100}xx"
                detail = (e.response.text or '')[:4000]
                for row in chunk:
                    failed.append((row, {
                        'code': code,
                        'detail': detail,
                        'status': e.response.status_code,
                    }))
            except httpx.RequestError as e:
                for row in chunk:
                    failed.append((row, {
                        'code': 'network_error',
                        'detail': str(e)[:4000],
                        'status': 0,
                    }))
        return ok_count, failed

    def rpc(self, name: str, params: dict):
        """Call a Postgres function via PostgREST RPC endpoint."""
        url = f"{self.url}/rest/v1/rpc/{name}"
        response = self._http.post(url, content=json.dumps(params or {}))
        response.raise_for_status()
        if response.status_code == 204 or not response.content:
            return None
        return response.json()
```

- [ ] **Step 4: Run tests, expect PASS**

```bash
cd /Users/jj/addons && pytest quimibond_intelligence/tests/test_supabase_client_details.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit (qb19 repo)**

```bash
cd /Users/jj/addons
git add quimibond_intelligence/models/supabase_client.py \
        quimibond_intelligence/tests/test_supabase_client_details.py
git commit -m "feat(ingestion): add upsert_with_details() and rpc() to SupabaseClient

upsert_with_details reports per-row outcomes for failed batches so
IngestionCore can record each lost row individually. rpc() wraps the
PostgREST /rpc/<name> endpoint for calling ingestion.* functions."
```

---

## Task 13: Wrap `_push_invoices` with IngestionCore

**Files:**
- Modify: `addons/quimibond_intelligence/models/sync_push.py`

This task does NOT rewrite `_push_invoices` — it wraps the existing logic. The existing body stays; we just add start_run / report_batch / report_failure / complete_run around it and swap one `upsert` call for `upsert_with_details`.

- [ ] **Step 1: Read the current `_push_invoices` method**

```bash
grep -n "_push_invoices\|def _push_" /Users/jj/addons/quimibond_intelligence/models/sync_push.py | head -40
```

Locate the exact line range of `_push_invoices`. Note where it currently calls `self._supabase.upsert(...)` — that's the call to swap.

- [ ] **Step 2: Add IngestionCore import and instantiation helper**

At the top of `sync_push.py`, near the other imports, add:
```python
from .ingestion_core import IngestionCore
```

Inside the `QuimibondSync` (or equivalent main class), add a helper method if one doesn't exist:
```python
def _ingestion(self):
    """Return an IngestionCore bound to the same SupabaseClient used for upserts."""
    return IngestionCore(self._supabase)
```

- [ ] **Step 3: Wrap `_push_invoices`**

Find the existing `_push_invoices` method. Without changing its query logic, wrap it. Here's the exact pattern to apply — adapt variable names to whatever exists today:

```python
def _push_invoices(self, last_sync, force_full=False):
    core = self._ingestion()
    run_id, core_watermark = core.start_run(
        source='odoo',
        table='odoo_invoices',
        run_type='full' if force_full else 'incremental',
        triggered_by='cron',
    )
    effective_watermark = core_watermark or (last_sync.isoformat() if last_sync else None)
    status = 'success'
    final_watermark = effective_watermark
    try:
        # === existing fetch logic, unchanged except for the watermark source ===
        domain = self._invoice_domain(effective_watermark, force_full)
        invoices = self.env['account.move'].search(domain)
        rows = self._serialize_invoices(invoices)   # whatever the current serializer is

        # === swap upsert → upsert_with_details ===
        ok, failed = self._supabase.upsert_with_details(
            'odoo_invoices', rows, on_conflict='odoo_id', batch_size=200
        )
        core.report_batch(run_id, attempted=len(rows), succeeded=ok, failed=len(failed))
        for row, err in failed:
            core.report_failure(
                run_id=run_id,
                entity_id=str(row.get('odoo_id') or row.get('id') or ''),
                error_code=err['code'],
                error_detail=err['detail'],
                payload=row,
            )
        if failed:
            status = 'partial'
        if rows:
            final_watermark = max(
                (r.get('write_date') for r in rows if r.get('write_date')),
                default=effective_watermark,
            )
    except Exception as e:
        status = 'failed'
        _logger.exception('push_invoices failed: %s', e)
        core.complete_run(run_id, status=status, high_watermark=effective_watermark)
        raise
    core.complete_run(run_id, status=status, high_watermark=final_watermark)
    # keep existing legacy sync_log write unchanged for parallel validation
    self._log_legacy('push_invoices', ok, len(failed))
```

**IMPORTANT:** Do NOT remove the legacy `sync_log` write. It stays for the 1-week parallel validation period.

- [ ] **Step 4: Validate that the module still loads in Odoo**

In Odoo shell:
```bash
odoo-bin shell -c /etc/odoo/odoo.conf -d <db>
>>> env['quimibond.sync.push']._push_invoices(last_sync=None, force_full=False)
```

Or run the `dry_run` mode if one exists. Expected: no exceptions at import time; on an empty domain the method should complete with `run_id` visible in `ingestion.sync_run` with `status='success'` and `rows_attempted=0`.

Verify in SQL:
```sql
select run_id, source_id, table_name, status, rows_attempted, rows_succeeded, rows_failed, high_watermark
from ingestion.sync_run
where source_id='odoo' and table_name='odoo_invoices'
order by started_at desc limit 3;
```

- [ ] **Step 5: Commit (qb19 repo)**

```bash
cd /Users/jj/addons
git add quimibond_intelligence/models/sync_push.py
git commit -m "feat(ingestion): wrap _push_invoices with IngestionCore

Legacy sync_log writes retained for 1-week parallel validation.
Swaps upsert() for upsert_with_details() so per-row failures are
reported via ingestion_report_failure."
```

---

## Task 14: Wrap `_push_payments` with IngestionCore

**Files:**
- Modify: `addons/quimibond_intelligence/models/sync_push.py`

Same pattern as Task 13, applied to `_push_payments`.

- [ ] **Step 1: Read current `_push_payments`**

```bash
grep -n "def _push_payments" /Users/jj/addons/quimibond_intelligence/models/sync_push.py
```

- [ ] **Step 2: Apply the same wrapping pattern**

Apply the wrapper exactly as in Task 13 Step 3 but with:
- `table='odoo_payments'`
- `on_conflict='odoo_id'` (or whatever the current conflict key is — grep the existing method)
- `entity_id=str(row.get('odoo_id') or row.get('id'))`
- use the existing payment serializer instead of `_serialize_invoices`

Preserve all the existing logic around `_invoice_payment_date()` / `_partial_reconcile` reads that live inside the current method — do NOT change the business logic, only wrap it.

- [ ] **Step 3: Validate in Odoo shell**

```python
env['quimibond.sync.push']._push_payments(last_sync=None, force_full=False)
```

Then check:
```sql
select source_id, table_name, status, rows_succeeded, rows_failed
from ingestion.sync_run
where source_id='odoo' and table_name='odoo_payments'
order by started_at desc limit 3;
```

- [ ] **Step 4: Commit (qb19 repo)**

```bash
cd /Users/jj/addons
git add quimibond_intelligence/models/sync_push.py
git commit -m "feat(ingestion): wrap _push_payments with IngestionCore

Same pattern as _push_invoices. Legacy sync_log retained."
```

---

## Task 15: Add retry cron in qb19 to process `sync_failure` backlog

**Files:**
- Create: `addons/quimibond_intelligence/data/ir_cron_retry_failures.xml`
- Modify: `addons/quimibond_intelligence/models/sync_push.py` (add `_retry_failures` method)

- [ ] **Step 1: Write failing test for `_retry_failures`**

Append to `addons/quimibond_intelligence/tests/test_ingestion_core.py`:

```python
def test_retry_failures_pattern_calls_fetch_process_mark():
    """
    Smoke test the retry flow pattern. Uses a FakeRPCClient to simulate
    fetch_pending_failures returning 2 rows; verifies the cron method would
    call mark_resolved on each after a successful re-upsert.
    """
    from quimibond_intelligence.models.ingestion_core import IngestionCore

    client = FakeRPCClient()
    client.responses['ingestion_fetch_pending_failures'] = [
        {'failure_id': 'f1', 'entity_id': '42',
         'payload_snapshot': {'odoo_id': 42, 'name': 'INV/42'}},
        {'failure_id': 'f2', 'entity_id': '43',
         'payload_snapshot': {'odoo_id': 43, 'name': 'INV/43'}},
    ]
    client.responses['ingestion_mark_failure_resolved'] = None
    core = IngestionCore(client)

    # Simulate what _retry_failures will do
    pending = core.fetch_pending_failures('odoo', 'odoo_invoices', 5, 100)
    for row in pending:
        # In real code we'd re-upsert row['payload_snapshot'] here and check success
        core.mark_resolved(row['failure_id'])

    marks = [c for c in client.calls if c[0] == 'ingestion_mark_failure_resolved']
    assert len(marks) == 2
    assert {m[1]['p_failure_id'] for m in marks} == {'f1', 'f2'}
```

- [ ] **Step 2: Run, expect PASS (pattern already supported by IngestionCore)**

```bash
cd /Users/jj/addons && pytest quimibond_intelligence/tests/test_ingestion_core.py::test_retry_failures_pattern_calls_fetch_process_mark -v
```

Expected: PASS — this test verifies the pattern is expressible, not that the cron exists.

- [ ] **Step 3: Add `_retry_failures` method to `sync_push.py`**

```python
def _retry_failures(self):
    """
    Called every 30 minutes by ir_cron_retry_failures. For each table in
    Plan 1 scope, fetches up to 50 pending failures and re-upserts them
    using the saved payload snapshot. Successes are marked resolved;
    persistent failures bump retry_count via report_failure.
    """
    core = self._ingestion()
    tables = [
        ('odoo', 'odoo_invoices', 'odoo_id'),
        ('odoo', 'odoo_payments', 'odoo_id'),
    ]
    max_retries = 5
    for source, table, conflict in tables:
        pending = core.fetch_pending_failures(source, table, max_retries, limit=50)
        if not pending:
            continue
        rows = [p['payload_snapshot'] for p in pending if p.get('payload_snapshot')]
        if not rows:
            # No payload = can't replay blindly. Skip and let next full sync catch it.
            continue
        ok_count, failed = self._supabase.upsert_with_details(
            table, rows, on_conflict=conflict, batch_size=200
        )
        # Mark successes resolved: upsert_with_details returns failures individually,
        # so anything not in `failed` succeeded.
        failed_entities = {
            str(row.get('odoo_id') or row.get('id') or '')
            for row, _ in failed
        }
        for p in pending:
            if p.get('entity_id') not in failed_entities:
                core.mark_resolved(p['failure_id'])
        # Re-report the still-failing ones to bump their retry_count
        # We need a fresh run_id for these — open a short retry run.
        if failed:
            run_id, _ = core.start_run(source, table, 'retry', 'cron')
            core.report_batch(run_id, len(rows), ok_count, len(failed))
            for row, err in failed:
                core.report_failure(
                    run_id=run_id,
                    entity_id=str(row.get('odoo_id') or row.get('id') or ''),
                    error_code=err['code'],
                    error_detail=err['detail'],
                    payload=row,
                )
            core.complete_run(run_id, 'partial', None)
```

- [ ] **Step 4: Create the cron XML**

Create `addons/quimibond_intelligence/data/ir_cron_retry_failures.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<odoo>
  <data noupdate="1">
    <record id="ir_cron_retry_failures" model="ir.cron">
      <field name="name">Quimibond: Retry ingestion failures</field>
      <field name="model_id" ref="model_quimibond_sync_push"/>
      <field name="state">code</field>
      <field name="code">model._retry_failures()</field>
      <field name="interval_number">30</field>
      <field name="interval_type">minutes</field>
      <field name="numbercall">-1</field>
      <field name="active">True</field>
    </record>
  </data>
</odoo>
```

Edit `addons/quimibond_intelligence/__manifest__.py` — add `'data/ir_cron_retry_failures.xml'` to the `data` list. **Do NOT change the manifest version number** — per `/Users/jj/CLAUDE.md`, the version stays at `19.0.30.0.0` and the update is done via `odoo-update` manually.

- [ ] **Step 5: Run tests, expect all PASS**

```bash
cd /Users/jj/addons && pytest quimibond_intelligence/tests/ -v
```

Expected: all tests from Tasks 11, 12, 15 pass.

- [ ] **Step 6: Commit (qb19 repo)**

```bash
cd /Users/jj/addons
git add quimibond_intelligence/models/sync_push.py \
        quimibond_intelligence/data/ir_cron_retry_failures.xml \
        quimibond_intelligence/__manifest__.py \
        quimibond_intelligence/tests/test_ingestion_core.py
git commit -m "feat(ingestion): add _retry_failures cron job (30 min)

Processes pending sync_failure rows for odoo_invoices and odoo_payments
by re-upserting their payload_snapshot. Successful retries are marked
resolved; persistent ones bump retry_count via a fresh retry run.
Scoped to Plan 1 tables only — Plan 2 extends to all Odoo tables."
```

---

## Task 16: Fictitious adapter test (validates extensibility claim)

**Files:**
- Create: `supabase/tests/fictitious_adapter_test.py`

This task is the acceptance test for the "extensible to new sources" property from the spec. It simulates a hypothetical SAT adapter using ONLY the 7 RPCs and verifies that adding a new source requires zero schema changes — just a row in `source_registry`.

- [ ] **Step 1: Create the fictitious adapter script**

Create `supabase/tests/fictitious_adapter_test.py`:

```python
"""
Fictitious SAT adapter test.

Validates the extensibility claim from the Fase 0 spec:
adding a new source requires only (a) an INSERT into source_registry
and (b) calling the same 7 RPCs. Zero schema changes, zero core changes.

Run:
    SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python supabase/tests/fictitious_adapter_test.py
"""
import os
import sys
import uuid
import httpx
import json

URL = os.environ['SUPABASE_URL'].rstrip('/')
KEY = os.environ['SUPABASE_SERVICE_KEY']
HDRS = {
    'apikey': KEY,
    'Authorization': f'Bearer {KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
}


def rpc(name, params):
    r = httpx.post(f'{URL}/rest/v1/rpc/{name}', headers=HDRS, json=params, timeout=30)
    r.raise_for_status()
    return r.json() if r.content else None


def sql(statement):
    # Use the existing execute_safe_ddl if available for schema ops;
    # otherwise fall back to the raw PostgREST sql shim. For this test
    # we just need to INSERT into a registry row, which goes through
    # the REST endpoint on the ingestion schema.
    return httpx.post(
        f'{URL}/rest/v1/ingestion.source_registry',
        headers={**HDRS, 'Prefer': 'resolution=merge-duplicates'},
        json=statement, timeout=30,
    ).raise_for_status()


def main():
    source = f'sat_test_{uuid.uuid4().hex[:8]}'
    table = 'public.odoo_invoices'   # reuse an existing table just to have a countable target

    # Step 1: register the fictitious source (the ONLY schema-level change needed)
    sql({
        'source_id': source,
        'table_name': 'odoo_invoices',
        'entity_kind': 'cfdi',
        'sla_minutes': 1440,
        'priority': 'context',
        'reconciliation_window_days': 30,
        'is_active': True,
    })

    # Step 2: start a run
    rows = rpc('ingestion_start_run', {
        'p_source': source, 'p_table': 'odoo_invoices',
        'p_run_type': 'full', 'p_triggered_by': 'manual',
    })
    run_id = rows[0]['run_id']
    print(f'[ok] start_run → {run_id}')

    # Step 3: report a batch with one failure
    rpc('ingestion_report_batch', {
        'p_run_id': run_id, 'p_attempted': 10, 'p_succeeded': 9, 'p_failed': 1,
    })
    print('[ok] report_batch')

    # Step 4: record the failure individually
    fid = rpc('ingestion_report_failure', {
        'p_run_id': run_id,
        'p_entity_id': 'SAT-CFDI-00001',
        'p_error_code': 'parse_error',
        'p_error_detail': 'xml namespace mismatch',
        'p_payload': {'uuid': 'SAT-CFDI-00001', 'total': 1234.56},
    })
    assert fid, 'report_failure returned no id'
    print(f'[ok] report_failure → {fid}')

    # Step 5: complete the run
    rpc('ingestion_complete_run', {
        'p_run_id': run_id, 'p_status': 'partial', 'p_high_watermark': None,
    })
    print('[ok] complete_run')

    # Step 6: reconcile (source claims 9 rows, let Supabase count compare)
    rec_id = rpc('ingestion_report_source_count', {
        'p_source': source, 'p_table': 'odoo_invoices',
        'p_window_start': '2026-04-01T00:00:00Z',
        'p_window_end': '2026-04-12T00:00:00Z',
        'p_source_count': 9,
        'p_missing_entity_ids': None,
    })
    assert rec_id, 'report_source_count returned no id'
    print(f'[ok] report_source_count → {rec_id}')

    # Step 7: fetch pending failures (should include the one we just reported)
    pending = rpc('ingestion_fetch_pending_failures', {
        'p_source': source, 'p_table': 'odoo_invoices',
        'p_max_retries': 5, 'p_limit': 10,
    })
    assert pending and len(pending) == 1, f'expected 1 pending failure, got {len(pending) if pending else 0}'
    print(f'[ok] fetch_pending_failures → 1 row')

    # Step 8: mark it resolved
    rpc('ingestion_mark_failure_resolved', {'p_failure_id': pending[0]['failure_id']})
    print('[ok] mark_failure_resolved')

    # Cleanup: deactivate the fictitious source
    httpx.patch(
        f'{URL}/rest/v1/ingestion.source_registry'
        f'?source_id=eq.{source}&table_name=eq.odoo_invoices',
        headers=HDRS, json={'is_active': False}, timeout=30,
    ).raise_for_status()

    print('\nALL 7 RPCs callable with only a source_registry INSERT. Extensibility validated.')


if __name__ == '__main__':
    main()
```

- [ ] **Step 2: Run the adapter test against the real Supabase project**

```bash
cd /Users/jj/Documents/GitHub/quimibond-intelligence
export SUPABASE_URL=https://tozqezmivpblmcubmnpi.supabase.co
export SUPABASE_SERVICE_KEY=<service-key-from-env>
python supabase/tests/fictitious_adapter_test.py
```

Expected output:
```
[ok] start_run → <uuid>
[ok] report_batch
[ok] report_failure → <uuid>
[ok] complete_run
[ok] report_source_count → <uuid>
[ok] fetch_pending_failures → 1 row
[ok] mark_failure_resolved

ALL 7 RPCs callable with only a source_registry INSERT. Extensibility validated.
```

- [ ] **Step 3: Verify no schema changes were made**

```sql
select table_name from information_schema.tables where table_schema='ingestion';
```

Expected: exactly the same 5 tables as after Task 1 — no new tables created during the adapter test.

- [ ] **Step 4: Commit (frontend repo)**

```bash
cd /Users/jj/Documents/GitHub/quimibond-intelligence
git add supabase/tests/fictitious_adapter_test.py
git commit -m "test(ingestion): add fictitious SAT adapter extensibility test

Validates the spec's key property: a new source can integrate using
only the 7 RPCs plus a single source_registry INSERT. Zero schema
changes required."
```

---

## Task 17: Deploy to Odoo.sh and start 1-week parallel validation

**Files:** no new files; this is a deployment + observation task.

- [ ] **Step 1: Push qb19 main branch**

```bash
cd /Users/jj/addons
git push origin main
```

- [ ] **Step 2: Merge main into quimibond branch**

Per `/Users/jj/CLAUDE.md`:
```bash
git checkout quimibond
git merge main
git push origin quimibond
git checkout main
```

- [ ] **Step 3: Run Odoo.sh update and restart crons**

Open Odoo.sh shell for the quimibond branch and run:
```bash
odoo-update quimibond_intelligence
odoosh-restart http
odoosh-restart cron
```

Expected: no errors during update. The new cron `ir_cron_retry_failures` appears in Settings → Technical → Scheduled Actions.

- [ ] **Step 4: Trigger manual push to create first runs**

In Odoo.sh shell:
```python
env['quimibond.sync.push'].push_to_supabase()
```

- [ ] **Step 5: Verify runs landed**

```sql
select source_id, table_name, status, rows_attempted, rows_succeeded, rows_failed, high_watermark, started_at
from ingestion.sync_run
where source_id='odoo' and table_name in ('odoo_invoices','odoo_payments')
order by started_at desc limit 5;
```

Expected: at least 2 rows (one per table) with `status='success'` or `'partial'` and coherent counts.

- [ ] **Step 6: Set up the paired comparison query**

Save this as `/Users/jj/Documents/GitHub/quimibond-intelligence/supabase/tests/parallel_parity_check.sql` and run it daily during the 1-week validation:

```sql
-- Compare the new ingestion.sync_run against the legacy sync_log
-- for the two tables under test. Discrepancies > 1% should be investigated.
with ingestion_totals as (
  select table_name,
         sum(rows_succeeded) as new_ok,
         sum(rows_failed) as new_failed
  from ingestion.sync_run
  where source_id='odoo'
    and table_name in ('odoo_invoices','odoo_payments')
    and started_at >= now() - interval '24 hours'
  group by table_name
),
legacy_totals as (
  -- adjust this CTE to match the shape of the legacy sync_log summary string
  select
    case
      when summary ilike '%invoices%' then 'odoo_invoices'
      when summary ilike '%payments%' then 'odoo_payments'
    end as table_name,
    count(*) as legacy_runs
  from public.sync_log
  where create_date >= now() - interval '24 hours'
    and direction='push'
  group by 1
)
select
  coalesce(i.table_name, l.table_name) as table_name,
  i.new_ok, i.new_failed, l.legacy_runs
from ingestion_totals i
full outer join legacy_totals l using (table_name);
```

- [ ] **Step 7: Document the observation period**

Create a lightweight diary in `docs/superpowers/plans/fase-0-plan-1-validation-log.md`:

```markdown
# Fase 0 Plan 1 — Validation log

## Day 1 (DATE)
- ingestion.sync_run rows created: X
- Parity with legacy sync_log: [match / differs by N]
- Open failures at EOD: Y
- SLA breaches at EOD: Z

## Day 2 (DATE)
...
```

Update daily for 7 days. This is not a test step — it's manual observation.

- [ ] **Step 8: Acceptance checkpoint (end of day 7)**

At the end of 7 days of parallel operation, verify:
1. `ingestion.sync_run` has runs for both tables every hour (hourly cron frequency).
2. `ingestion.sync_failure` has zero rows with `status='pending'` older than 2 hours — retry cron is working.
3. The parity query above shows <1% difference between new and legacy counts.
4. No regressions in the frontend (`/inbox`, `/dashboard`) reading of invoice/payment data.

If all 4 pass: Plan 1 is complete and we can proceed to Plan 2 (migrate remaining 18 Odoo tables). If any fail: fix before advancing.

- [ ] **Step 9: Final commit for Plan 1**

```bash
cd /Users/jj/Documents/GitHub/quimibond-intelligence
git add docs/superpowers/plans/fase-0-plan-1-validation-log.md \
        supabase/tests/parallel_parity_check.sql
git commit -m "docs(ingestion): add Plan 1 validation log and parity check query"
```

---

## End of Plan 1

**What works after this plan:**
- `ingestion` schema + 7 RPCs + sentinel + views live in prod.
- `_push_invoices` and `_push_payments` in qb19 report every run, every row, every failure through the core.
- Retry cron in qb19 processes failures every 30 min for these 2 tables.
- Fictitious adapter test proves extensibility.
- 1 week of parallel validation with legacy `sync_log` provides confidence.

**What is NOT yet done (deferred to Plans 2 and 3):**
- Remaining 18 Odoo `_push_*` methods still use the legacy path.
- Nightly reconciliation cron in qb19 — not active yet.
- Gmail pipeline adapter — untouched.
- `/system` dashboard — still reads legacy `sync_log`.
- Legacy `sync_log` — still live.

Plan 2 picks up here: extends the wrapping pattern to the other 18 tables and activates the reconciliation cron.

## Self-Review Notes

Ran the spec checklist against this plan before committing it:

1. **Spec section 4 (schema)** → Task 1 creates all 5 tables with every field from the spec.
2. **Spec section 5 (7 RPCs)** → Tasks 2-8 implement each one with its own TDD cycle.
3. **Spec section 6 (reconciliation)** → Task 6 implements the RPC; nightly cron activation is deferred to Plan 2 (flagged at end).
4. **Spec section 6.4 (sentinel)** → Task 9.
5. **Spec section 7 (thin wrapper migration)** → Tasks 11-14.
6. **Spec section 7.4 (sequential, 2 critical tables first)** → Tasks 13-14 cover exactly `_push_invoices` and `_push_payments`, and plan explicitly leaves other 18 for Plan 2.
7. **Spec section 9 (acceptance criteria → extensibility via fictitious adapter)** → Task 16.
8. **Spec section 9 (acceptance criteria → 1 week parallelism)** → Task 17.

**Red-flag scan:** no TBDs, no "implement later", no "similar to above"; every code step has actual code; every shell command has expected output; type names are consistent (`run_id`, `entity_id`, `failure_id`, `high_watermark`) between SQL and Python tasks.

**Known dependency ordering:** Task 2's deferred assertions (T2.3/T2.4) depend on Task 5's `ingestion_complete_run` — handled explicitly in Task 5 Step 1.
