-- Situación: el bot de situaciones deja de correr cada hora (decisión del CEO 2026-10-22, por costo).
--
-- El push de Odoo es diario (cron de qb19 a las 04:48 UTC) y dispara al bot al terminar
-- (senales_push_terminado). El respaldo horario hacía que el bot corriera ~22 veces al día de
-- todos modos (US$83 en 30 días, el gasto más grande de Claude). Ahora el respaldo corre UNA vez,
-- a las 11:50 UTC, 40 min antes del correo diario (situacion_digest, 12:30), para que el correo
-- salga con las señales de memoria del día. Mismo cuerpo que 20260920a: solo si no hubo corrida
-- en 50 min.
--
-- Rollback: volver a programar '20 * * * *' con el mismo comando (20260920a).
DO $do$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'situacion_respaldo' LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $do$;

SELECT cron.schedule('situacion_respaldo', '50 11 * * *',
  $cmd$SELECT public.invoke_edge('situacion-consolidar', '{"origen":"cron"}'::jsonb)
       WHERE NOT EXISTS (SELECT 1 FROM public.situacion_corridas WHERE iniciada_en > now() - interval '50 minutes')$cmd$);

INSERT INTO pipeline_logs (level, phase, message, details)
VALUES ('info', 'migration', 'Situación: situacion_respaldo pasa de cada hora a diario 11:50 UTC (costo)',
        jsonb_build_object('migration', '20261022a_situacion_bot_diario'));
