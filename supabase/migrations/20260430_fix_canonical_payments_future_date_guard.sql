-- One-shot fix for the syntage_invoice_payments row with fecha_pago='2029-05-29'
-- (UUID a13b06bf-9d0a-4540-bcef-2ccc70a466ab, $4,105.24, taxpayer PNT920218IW5).
-- Set to NULL so it stops polluting cash projections + 7d windows. The trigger
-- canonical_payments_upsert_from_sat propagates NULL to canonical_payments on UPDATE.
--
-- Plus a durable BEFORE INSERT/UPDATE guard that clamps any future-dated
-- fecha_pago (>1y out) to NULL with a tag in raw_payload so QA can find them.
--
-- Applied via supabase MCP apply_migration on 2026-04-30 by Claude.
UPDATE syntage_invoice_payments
SET    fecha_pago = NULL,
       synced_at  = COALESCE(synced_at, now())
WHERE  uuid_complemento = 'a13b06bf-9d0a-4540-bcef-2ccc70a466ab'
  AND  fecha_pago > current_date + interval '1 year';

CREATE OR REPLACE FUNCTION syntage_payment_clamp_future_date()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.fecha_pago IS NOT NULL AND NEW.fecha_pago > now() + interval '1 year' THEN
    NEW.fecha_pago := NULL;
    NEW.raw_payload := COALESCE(NEW.raw_payload, '{}'::jsonb)
      || jsonb_build_object('_qi_future_date_clamped',
           jsonb_build_object('original_fecha_pago', (NEW.fecha_pago)::text,
                              'clamped_at', now()));
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_syntage_payment_clamp_future ON syntage_invoice_payments;
CREATE TRIGGER trg_syntage_payment_clamp_future
BEFORE INSERT OR UPDATE OF fecha_pago ON syntage_invoice_payments
FOR EACH ROW EXECUTE FUNCTION syntage_payment_clamp_future_date();
