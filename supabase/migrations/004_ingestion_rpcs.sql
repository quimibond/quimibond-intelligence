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

-- 3. ingestion_report_failure: record one failed row. Idempotent on
-- (source,table,entity_id) while status is pending/retrying.
-- Looks up source/table from sync_run to keep the contract minimal and
-- to validate the run_id exists.
create or replace function ingestion_report_failure(
  p_run_id uuid,
  p_entity_id text,
  p_error_code text,
  p_error_detail text,
  p_payload jsonb
) returns uuid
language plpgsql security definer
set search_path = ingestion, pg_catalog
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

-- 4. ingestion_complete_run: close a run with final status and watermark
create or replace function ingestion_complete_run(
  p_run_id uuid,
  p_status text,
  p_high_watermark text
) returns void
language plpgsql security definer
set search_path = ingestion, pg_catalog
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

-- 5. ingestion_report_source_count: reconcile source vs supabase counts,
-- auto-heal by injecting failures for known-missing entity_ids.
-- p_missing_entity_ids: the full set of IDs the source reported (or just the
-- missing subset — function cross-checks against the target table and only
-- injects failures for IDs that are confirmed absent).
create or replace function ingestion_report_source_count(
  p_source text,
  p_table text,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_source_count int,
  p_missing_entity_ids text[]
) returns uuid
language plpgsql security definer
set search_path = ingestion, public, pg_temp, pg_catalog
as $$
declare
  v_rec_id uuid;
  v_sb_count int;
  v_divergence int;
  v_status text;
  v_healed int := 0;
  v_synthetic_run uuid;
  v_missing_id text;
  v_is_absent boolean;
begin
  -- Verify source is registered
  if not exists (
    select 1 from ingestion.source_registry
    where source_id = p_source and table_name = p_table
  ) then
    raise exception 'ingestion_report_source_count: source (%, %) not in registry', p_source, p_table;
  end if;

  -- Count rows in the target table (found via search_path: public, pg_temp)
  execute format('select count(*) from %I', p_table) into v_sb_count;

  -- Handle null source_count explicitly to satisfy the reconciliation_run CHECK constraint:
  -- (source_count IS NULL) => divergence must also be NULL and status must be 'unknown'
  if p_source_count is null then
    v_divergence := null;
    v_status := 'unknown';
  else
    v_divergence := p_source_count - v_sb_count;
    if v_divergence = 0 then
      v_status := 'clean';
    elsif v_divergence > 0 then
      v_status := 'divergent_positive';
    else
      v_status := 'divergent_negative';
    end if;
  end if;

  -- Auto-heal only for positive divergence WITH a list of candidate ids.
  -- We cross-check each candidate against the target table and only inject
  -- a sync_failure for IDs that are confirmed absent (not found in the table).
  if v_status = 'divergent_positive' and p_missing_entity_ids is not null then
    -- Open a synthetic sync_run so failures have a valid parent run_id FK
    insert into ingestion.sync_run
      (source_id, table_name, run_type, triggered_by, status, ended_at)
    values
      (p_source, p_table, 'retry', 'reconciliation', 'success', now())
    returning run_id into v_synthetic_run;

    foreach v_missing_id in array p_missing_entity_ids loop
      -- Only inject a failure if the id is actually absent from the target table
      execute format(
        'select not exists (select 1 from %I where id = $1)', p_table
      ) into v_is_absent using v_missing_id;

      if v_is_absent then
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
      end if;
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

-- 6. ingestion_fetch_pending_failures: atomically claim pending failures for a
-- retry worker. Uses FOR UPDATE SKIP LOCKED + CTE update so concurrent workers
-- never double-claim the same row.
create or replace function ingestion_fetch_pending_failures(
  p_source text,
  p_table text,
  p_max_retries int,
  p_limit int
) returns setof ingestion.sync_failure
language plpgsql security definer
set search_path = ingestion, pg_catalog
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
