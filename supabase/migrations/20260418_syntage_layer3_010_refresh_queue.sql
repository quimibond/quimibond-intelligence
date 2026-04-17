-- Fase 5 · 010 refresh queue trigger system
-- Mitiga freshness gap: 15min MV vs live Odoo → máx 7min worst case.

CREATE TABLE IF NOT EXISTS public.unified_refresh_queue (
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  PRIMARY KEY (requested_at)
);

CREATE INDEX IF NOT EXISTS unified_refresh_queue_pending_idx
  ON public.unified_refresh_queue (processed_at) WHERE processed_at IS NULL;

REVOKE ALL ON public.unified_refresh_queue FROM anon, authenticated;
GRANT ALL ON public.unified_refresh_queue TO service_role;

CREATE OR REPLACE FUNCTION public.trg_schedule_unified_refresh()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.unified_refresh_queue (requested_at) VALUES (now())
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS odoo_invoices_refresh_trigger ON public.odoo_invoices;
CREATE TRIGGER odoo_invoices_refresh_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.odoo_invoices
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_schedule_unified_refresh();

DROP TRIGGER IF EXISTS odoo_payments_refresh_trigger ON public.odoo_account_payments;
CREATE TRIGGER odoo_payments_refresh_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.odoo_account_payments
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_schedule_unified_refresh();

DROP TRIGGER IF EXISTS syntage_invoices_refresh_trigger ON public.syntage_invoices;
CREATE TRIGGER syntage_invoices_refresh_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.syntage_invoices
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_schedule_unified_refresh();

DROP TRIGGER IF EXISTS syntage_payments_refresh_trigger ON public.syntage_invoice_payments;
CREATE TRIGGER syntage_payments_refresh_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.syntage_invoice_payments
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_schedule_unified_refresh();

-- Debounced cron: cada 2min, check pending + min gap 5min desde último refresh
DO $$
BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'debounced-unified-refresh';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'debounced-unified-refresh',
  '*/2 * * * *',
  $job$
    DO $$
    DECLARE
      last_refresh timestamptz;
      has_pending boolean;
    BEGIN
      SELECT max(refreshed_at) INTO last_refresh FROM public.invoices_unified;
      SELECT EXISTS(SELECT 1 FROM public.unified_refresh_queue WHERE processed_at IS NULL) INTO has_pending;

      IF has_pending AND (last_refresh IS NULL OR last_refresh < now() - interval '5 minutes') THEN
        PERFORM public.refresh_invoices_unified();
        PERFORM public.refresh_payments_unified();
        UPDATE public.unified_refresh_queue SET processed_at = now() WHERE processed_at IS NULL;
      END IF;

      DELETE FROM public.unified_refresh_queue WHERE processed_at < now() - interval '7 days';
    END $$;
  $job$
);

COMMENT ON TABLE public.unified_refresh_queue IS 'Fase 5 · Queue para debounced refresh de invoices_unified/payments_unified. Trigger en odoo/syntage tables enqueue, cron cada 2min procesa.';
