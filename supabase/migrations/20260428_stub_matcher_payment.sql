-- Stub para destrabar el trigger trg_matcher_payment_after_sat.
-- 49 errores en ultimos 7d en syntage_webhook por: function matcher_payment(text) does not exist.
-- El stub retorna NULL -> el trigger no auto-mergea, pero los pagos SAT ingestan limpiamente.
-- Match manual sigue disponible via /api/inbox/action/link_manual y mdm_link_invoice.
-- TODO: implementar matcher real (amount + date + counterparty) en SP6.

CREATE OR REPLACE FUNCTION public.matcher_payment(p_canonical_id text)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Stub: returns NULL until real implementation lands.
  -- Trigger trg_matcher_payment_after_sat checks IS NOT NULL before merging,
  -- so NULL = no-op, no behavioral change for ingestion.
  RETURN NULL;
END;
$function$;
