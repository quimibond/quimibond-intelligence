-- Fase 5 · 015 DISABLE refresh queue system (PR 0 rollback)
--
-- Root cause detected 2026-04-19: el sistema de refresh queue + triggers
-- causaba connection pool exhaustion en Supabase:
-- - Triggers STATEMENT-level en 4 tablas firing on every upsert (pull-sync
--   batch upsert = 100+ firings en seconds)
-- - Debounced cron cada 2min procesa queue, cada refresh toma 1-2min
-- - Overlap entre refreshes + queue processing + batch upserts = DB saturada
-- - PostgREST devolvía 503 Service Unavailable en /rest/v1/emails,
--   /companies, /agent_insights, /pipeline_logs → frontend entero roto
--
-- Fix: volver al /15min cron original (refresh-syntage-unified). Eso toma
-- 1-2min cada vez pero deja 13-14min de DB quieta. La freshness trade-off
-- (15min stale max vs 7min con queue) no vale la pena frente a la
-- estabilidad.

-- Drop triggers (removían fire-on-every-row)
DROP TRIGGER IF EXISTS odoo_invoices_refresh_trigger ON public.odoo_invoices;
DROP TRIGGER IF EXISTS odoo_payments_refresh_trigger ON public.odoo_account_payments;
DROP TRIGGER IF EXISTS syntage_invoices_refresh_trigger ON public.syntage_invoices;
DROP TRIGGER IF EXISTS syntage_payments_refresh_trigger ON public.syntage_invoice_payments;

DROP FUNCTION IF EXISTS public.trg_schedule_unified_refresh();

-- Unschedule debounced cron
DO $$
BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'debounced-unified-refresh';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Drop queue table (no-op si ya no se usa)
DROP TABLE IF EXISTS public.unified_refresh_queue CASCADE;

COMMENT ON FUNCTION public.refresh_invoices_unified() IS
  'Fase 3 · REFRESH CONCURRENTLY invoices_unified. Cadence via refresh-syntage-unified pg_cron @ */15min. '
  'Fase 5 queue system removido en 015 por connection pool exhaustion.';
