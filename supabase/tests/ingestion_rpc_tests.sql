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
begin
  -- T2.1: start_run returns a non-null run_id
  select * into r1
  from ingestion_start_run('test_src','test_tbl','incremental','cron');

  if r1.run_id is null then
    raise exception 'T2.1: start_run returned null run_id';
  end if;

  -- T2.2: first run last_watermark should be null (no prior successful run)
  if r1.last_watermark is not null then
    raise exception 'T2.2: first run last_watermark should be null, got %', r1.last_watermark;
  end if;

  raise notice 'T2 PASS: ingestion_start_run';
end $$;

-- requires ingestion_complete_run (Task 5)
-- do $$
-- declare
--   r1 record;
--   r2 record;
-- begin
--   select * into r1
--   from ingestion_start_run('test_src','test_tbl','incremental','cron');
--
--   -- Complete the first run with a watermark
--   perform ingestion_complete_run(r1.run_id, 'success', '2026-04-12T10:00:00Z');
--
--   -- Second call: watermark should come back from the completed run
--   select * into r2
--   from ingestion_start_run('test_src','test_tbl','incremental','cron');
--
--   -- T2.3: watermark from completed run is returned
--   if r2.last_watermark is distinct from '2026-04-12T10:00:00Z' then
--     raise exception 'T2.3: second run watermark mismatch, got %', r2.last_watermark;
--   end if;
--
--   -- T2.4: fresh run_id is issued each time
--   if r2.run_id = r1.run_id then
--     raise exception 'T2.4: start_run should return a fresh run_id';
--   end if;
--
--   raise notice 'T2.3/T2.4 PASS: watermark propagation';
-- end $$;

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

rollback;
