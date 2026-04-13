-- supabase/migrations/005_ingestion_sentinel_and_views.sql
-- Fase 0 Plan 1: sentinel function + pg_cron schedule + 3 health views

-- Sentinel: for every active registry row, flag if reconciliation_run
-- hasn't executed in 25 hours. Open sla_breach rows unless one already exists.
create or replace function ingestion.check_missing_reconciliations()
returns int
language plpgsql security definer
set search_path = ingestion, pg_catalog
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
