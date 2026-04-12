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

rollback;
