-- Retiro de Vercel (2/3): watchdog en Edge Function `health`.
--
-- 1. RPC memoria_cron_health(): estado de los jobs pg_cron memoria_* (cron.job
--    no está expuesto por PostgREST; SECURITY DEFINER, solo service_role).
-- 2. Job memoria_watchdog cada hora en :05 → invoke_edge('health').
-- 3. memoria_attachments_extract pasa a cada minuto: el backfill histórico
--    registra ~700 adjuntos con extractor por cada 1,000 correos y a 4 por
--    corrida cada 2 min la cola no bajaba.

CREATE OR REPLACE FUNCTION public.memoria_cron_health()
RETURNS TABLE (jobname text, active boolean, schedule text, last_ok timestamptz, last_run timestamptz, failures_3h bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT j.jobname, j.active, j.schedule,
         max(d.start_time) FILTER (WHERE d.status = 'succeeded') AS last_ok,
         max(d.start_time) AS last_run,
         count(*) FILTER (WHERE d.status = 'failed' AND d.start_time > now() - interval '3 hours') AS failures_3h
  FROM cron.job j
  LEFT JOIN cron.job_run_details d ON d.jobid = j.jobid AND d.start_time > now() - interval '3 days'
  WHERE j.jobname LIKE 'memoria_%'
  GROUP BY j.jobname, j.active, j.schedule
  ORDER BY j.jobname;
$$;
REVOKE ALL ON FUNCTION public.memoria_cron_health() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.memoria_cron_health() TO service_role;
COMMENT ON FUNCTION public.memoria_cron_health() IS 'Watchdog: última corrida exitosa y fallos recientes de los jobs pg_cron memoria_*.';

DO $do$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'memoria_watchdog' LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'memoria_attachments_extract' LOOP
    PERFORM cron.alter_job(job_id := j.jobid, schedule := '* * * * *');
  END LOOP;
END $do$;

SELECT cron.schedule('memoria_watchdog', '5 * * * *', $cmd$SELECT public.invoke_edge('health')$cmd$);

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE', 'cron.job',
       'Retiro de Vercel: watchdog en Edge Function health (job memoria_watchdog hourly) + RPC memoria_cron_health; attachments-extract cada minuto',
       'supabase/migrations/20260916g_watchdog_edge.sql', 'vercel-retiro-watchdog', true
WHERE NOT EXISTS (SELECT 1 FROM public.schema_changes WHERE triggered_by = 'vercel-retiro-watchdog');
