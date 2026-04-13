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
set search_path = ingestion, pg_catalog
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

-- 2. ingestion_report_batch: accumulate counters atomically on a live run
create or replace function ingestion_report_batch(
  p_run_id uuid,
  p_attempted int,
  p_succeeded int,
  p_failed int
) returns void
language plpgsql security definer
set search_path = ingestion, pg_catalog
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

-- 3. ingestion_report_failure: upsert a failed entity row with idempotency via partial unique index
create or replace function ingestion_report_failure(
  p_run_id         uuid,
  p_source         text,
  p_table          text,
  p_entity_id      text,
  p_error_code     text,
  p_error_detail   text,
  p_payload        jsonb
) returns uuid
language plpgsql security definer
set search_path = ingestion, pg_catalog
as $$
declare
  v_failure_id uuid;
begin
  insert into ingestion.sync_failure
    (run_id, source_id, table_name, entity_id, error_code, error_detail, payload_snapshot, status, last_tried_at)
  values
    (p_run_id, p_source, p_table, p_entity_id, p_error_code, p_error_detail, p_payload, 'pending', now())
  on conflict (source_id, table_name, entity_id)
    where status in ('pending','retrying')
  do update set
    retry_count   = ingestion.sync_failure.retry_count + 1,
    error_code    = excluded.error_code,
    error_detail  = excluded.error_detail,
    last_tried_at = now()
  returning failure_id into v_failure_id;

  return v_failure_id;
end $$;

grant execute on function ingestion_report_failure(uuid,text,text,text,text,text,jsonb) to service_role;
