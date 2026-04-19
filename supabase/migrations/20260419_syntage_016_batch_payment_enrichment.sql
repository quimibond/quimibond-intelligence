-- Syntage · Enriquecimiento inline de payments desde raw_payload.batchPayment
--
-- Descubrimiento: el payload de Syntage trae batchPayment como objeto embebido
-- (no como IRI). Los campos fiscales que payments_unified necesita ya están
-- ahí sin segundo HTTP call:
--   raw_payload.batchPayment.operationNumber        → num_operacion
--   raw_payload.batchPayment.date                   → fecha_pago
--   raw_payload.batchPayment.paymentMethod          → forma_pago_p
--   raw_payload.batchPayment.payerBank[0].rfc       → rfc_emisor_cta_ord
--   raw_payload.batchPayment.beneficiaryBank[0].rfc → rfc_emisor_cta_ben
--
-- OBSERVACIÓN crítica: en el dataset actual payerBank/beneficiaryBank vienen
-- `[]` vacíos (Syntage no expone banco para este taxpayer). El composite
-- match Nivel 2 en payments_unified queda efectivamente dormant — migración
-- 017 lo retira.
--
-- Las filas CSV-imported (25,468) NO tienen batchPayment en raw_payload →
-- estos campos quedan null hasta re-pull via /api/syntage/pull-sync.

ALTER TABLE public.syntage_invoice_payments
  ADD COLUMN IF NOT EXISTS batch_payment_id text;

CREATE INDEX IF NOT EXISTS idx_syntage_payments_batch_id
  ON public.syntage_invoice_payments (batch_payment_id)
  WHERE batch_payment_id IS NOT NULL;

COMMENT ON COLUMN public.syntage_invoice_payments.batch_payment_id IS
  'IRI del BatchPayment de Syntage (ej: "/invoices/batch-payments/abc"). '
  'Denormalizado desde raw_payload.batchPayment.@id para queries rápidas.';

-- One-shot backfill desde raw_payload.batchPayment para rows ya ingeridos
-- via webhook o pull-sync. COALESCE preserva fecha_pago existente si el
-- batch no la trae.
UPDATE public.syntage_invoice_payments
SET
  batch_payment_id = COALESCE(
    raw_payload->'batchPayment'->>'@id',
    raw_payload->'batchPayment'->>'id'
  ),
  num_operacion      = NULLIF(raw_payload->'batchPayment'->>'operationNumber', ''),
  rfc_emisor_cta_ord = NULLIF(raw_payload->'batchPayment'->'payerBank'->0->>'rfc', ''),
  rfc_emisor_cta_ben = NULLIF(raw_payload->'batchPayment'->'beneficiaryBank'->0->>'rfc', ''),
  fecha_pago = COALESCE(
    (NULLIF(raw_payload->'batchPayment'->>'date', ''))::timestamptz,
    fecha_pago
  ),
  forma_pago_p = COALESCE(
    NULLIF(raw_payload->'batchPayment'->>'paymentMethod', ''),
    forma_pago_p
  )
WHERE raw_payload ? 'batchPayment';
