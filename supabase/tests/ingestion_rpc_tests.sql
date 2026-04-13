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

-- ===== Task 4: ingestion_report_failure =====
do $$
declare
  v_run    uuid;
  v_fid1   uuid;
  v_fid2   uuid;
  v_count  int;
  v_retry  int;
  v_fid3   uuid;
begin
  -- Start a run to satisfy the run_id FK
  select run_id into v_run
  from ingestion_start_run('test_src','test_tbl','incremental','cron');

  -- T4.1: first report for entity 'ent-001' returns a non-null failure_id
  select ingestion_report_failure(
    v_run, 'test_src', 'test_tbl', 'ent-001',
    'ERR_TIMEOUT', 'connection timed out', null
  ) into v_fid1;

  if v_fid1 is null then
    raise exception 'T4.1: first report_failure returned null failure_id';
  end if;

  -- T4.2: second report for same (source, table, entity) returns the same failure_id (idempotent)
  select ingestion_report_failure(
    v_run, 'test_src', 'test_tbl', 'ent-001',
    'ERR_TIMEOUT', 'connection timed out again', null
  ) into v_fid2;

  if v_fid2 is distinct from v_fid1 then
    raise exception 'T4.2: idempotent call returned different id: % vs %', v_fid1, v_fid2;
  end if;

  -- T4.3: only 1 row exists for entity 'ent-001'
  select count(*) into v_count
  from ingestion.sync_failure
  where source_id = 'test_src'
    and table_name = 'test_tbl'
    and entity_id = 'ent-001';

  if v_count <> 1 then
    raise exception 'T4.3: expected 1 row for ent-001, got %', v_count;
  end if;

  -- T4.4: retry_count was incremented to 1 after the second call
  select retry_count into v_retry
  from ingestion.sync_failure
  where source_id = 'test_src'
    and table_name = 'test_tbl'
    and entity_id = 'ent-001'
    and status in ('pending','retrying');

  if v_retry <> 1 then
    raise exception 'T4.4: expected retry_count=1, got %', v_retry;
  end if;

  -- T4.5: a distinct entity 'ent-002' creates a second row
  select ingestion_report_failure(
    v_run, 'test_src', 'test_tbl', 'ent-002',
    'ERR_NOT_FOUND', 'record missing', null
  ) into v_fid3;

  select count(*) into v_count
  from ingestion.sync_failure
  where source_id = 'test_src'
    and table_name = 'test_tbl';

  if v_count <> 2 then
    raise exception 'T4.5: expected 2 rows total, got %', v_count;
  end if;

  raise notice 'T4 PASS: ingestion_report_failure';
end $$;

rollback;
