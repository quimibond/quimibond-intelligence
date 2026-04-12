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
