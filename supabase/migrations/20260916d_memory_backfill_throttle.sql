-- Memoria: throttle del backfill histórico.
--
-- Al sembrar las 52 cuentas, invoke_edge_backfill_pending() lanzó 52
-- invocaciones simultáneas de backfill-sweep (cada una ~15-60 s de trabajo)
-- y el runtime de Edge Functions no aguantó: 47 respuestas 504 y 3
-- BOOT_ERROR. El sync (52 llamadas de ~1 s) sí lo tolera; el backfill no.
--
-- Ahora: máximo p_max cuentas por corrida (las menos recientes, marcadas como
-- reclamadas con updated_at = now() para rotar) y el job corre cada minuto.
-- 3 cuentas × 2 páginas × 100 correos = ~600 correos/min.

BEGIN;

DROP FUNCTION IF EXISTS public.invoke_edge_backfill_pending();

CREATE OR REPLACE FUNCTION public.invoke_edge_backfill_pending(p_max integer DEFAULT 3)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    UPDATE public.email_backfill_state s
       SET updated_at = now()
     WHERE s.account IN (
       SELECT account FROM public.email_backfill_state
        WHERE NOT done
        ORDER BY updated_at, account
        LIMIT greatest(p_max, 0)
     )
    RETURNING s.account
  LOOP
    PERFORM public.invoke_edge('backfill-sweep', jsonb_build_object('account', r.account));
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.invoke_edge_backfill_pending(integer) FROM public, anon, authenticated;
COMMENT ON FUNCTION public.invoke_edge_backfill_pending(integer) IS
  'Lanza backfill-sweep para las p_max cuentas pendientes menos recientes (rotación por updated_at). No subir p_max sin medir: el runtime de Edge se cae con decenas de invocaciones largas simultáneas.';

DO $do$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'memoria_backfill_sweep' LOOP
    PERFORM cron.alter_job(job_id := j.jobid, schedule := '* * * * *', command := $cmd$SELECT public.invoke_edge_backfill_pending(3)$cmd$);
  END LOOP;
END $do$;

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'ALTER', 'email_backfill_state',
       'Memoria: invoke_edge_backfill_pending(p_max=3) con rotación por updated_at; job memoria_backfill_sweep cada minuto',
       'supabase/migrations/20260916d_memory_backfill_throttle.sql', 'memoria-backfill-throttle', true
WHERE NOT EXISTS (SELECT 1 FROM public.schema_changes WHERE triggered_by = 'memoria-backfill-throttle');

COMMIT;
