-- 2026-09-24b — Situación plan B, paso 4: correo diario de situación a las 06:30 CDMX (12:30 UTC).
-- Sustituye al resumen de correo (memoria_email_digest, 12:45 UTC): se desprograma aquí; la Edge
-- Function email-digest y sus RPCs se retiran en 20260926a, tras la aceptación del CEO.
DO $do$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname IN ('situacion_digest', 'memoria_email_digest') LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $do$;

SELECT cron.schedule('situacion_digest', '30 12 * * *',
  $cmd$SELECT public.invoke_edge('situacion-digest', '{"origen":"cron"}'::jsonb)$cmd$);

-- El watchdog lee memoria_cron_health(), que hoy solo devuelve jobs memoria_%: sin esto,
-- `situacion_digest: job no existe` cada hora. (Cuerpo de 20260916g con el WHERE ampliado a situacion_%.)
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
  WHERE j.jobname LIKE 'memoria_%' OR j.jobname LIKE 'situacion_%'
  GROUP BY j.jobname, j.active, j.schedule
  ORDER BY j.jobname;
$$;
COMMENT ON FUNCTION public.memoria_cron_health() IS 'Watchdog: última corrida exitosa y fallos recientes de los jobs pg_cron memoria_* y situacion_*.';

INSERT INTO pipeline_logs (level, phase, message, details)
VALUES ('info', 'migration', 'Situación plan B paso 4: job situacion_digest 12:30 UTC; memoria_email_digest desprogramado; memoria_cron_health ve situacion_*',
        jsonb_build_object('migration', '20260924b_situacion_digest_cron'));
