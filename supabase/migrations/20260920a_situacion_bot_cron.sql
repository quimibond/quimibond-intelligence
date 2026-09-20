-- Situación plan A — paso 3: job de respaldo del bot (spec §6.1).
-- El disparo normal es por evento (senales_push_terminado al terminar el push
-- horario de Odoo). Este job corre a :20 solo si no hubo corrida en 50 min
-- (push de Odoo caído, o señales de memoria sin Odoo).
DO $do$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'situacion_respaldo' LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $do$;

SELECT cron.schedule('situacion_respaldo', '20 * * * *',
  $cmd$SELECT public.invoke_edge('situacion-consolidar', '{"origen":"cron"}'::jsonb)
       WHERE NOT EXISTS (SELECT 1 FROM public.situacion_corridas WHERE iniciada_en > now() - interval '50 minutes')$cmd$);

INSERT INTO pipeline_logs (level, phase, message, details)
VALUES ('info', 'migration', 'Situación plan A paso 3: job situacion_respaldo (hourly :20, solo si no corrió en 50 min)',
        jsonb_build_object('migration', '20260920a_situacion_bot_cron'));
