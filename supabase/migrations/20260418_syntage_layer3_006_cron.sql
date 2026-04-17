-- Fase 3 Layer 3 · 006 pg_cron schedule
-- Cada 15min: refresh_invoices_unified + refresh_payments_unified.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Limpiar job previo (idempotente)
DO $$
BEGIN
  PERFORM cron.unschedule(jobname)
  FROM cron.job
  WHERE jobname = 'refresh-syntage-unified';
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Schedule nuevo
SELECT cron.schedule(
  'refresh-syntage-unified',
  '*/15 * * * *',
  $job$
    SELECT public.refresh_invoices_unified();
    SELECT public.refresh_payments_unified();
  $job$
);

COMMENT ON EXTENSION pg_cron IS 'Fase 3 · schedule refresh-syntage-unified @ */15 * * * *';
