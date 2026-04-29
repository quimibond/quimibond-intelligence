-- supabase/migrations/20260428_p1_4_syntage_2029_fecha_pago_fix.sql
--
-- P1-4 audit fix (2026-04-28): syntage_invoice_payments.fecha_pago=2029 corruption
--
-- DIAG: 1 row con año 2029 (syntage_id=a13b06bf-9d0a-4540-bcef-2ccc70a466ab,
-- fecha_pago=2029-05-29, monto=4105.24, synced_at=2026-04-18). Resto del histórico
-- está dentro de rango razonable (2015-2026). Es source-side corruption en CFDI/SAT —
-- no controlamos Syntage como fuente.
--
-- FIX
-- ---
-- 1) NULL la fecha_pago del row corrupto (no perdemos el row ni monto, solo la fecha
--    irreal que contamina cash projections y aging).
-- 2) CHECK constraint defensivo: rechaza fecha_pago > 2050-01-01 en futuros INSERTs
--    (límite generoso). Si Syntage manda otra corrupción, el ingest fallará visibly
--    en pipeline_logs en vez de contaminar silenciosamente.

BEGIN;

-- One-shot: fix the known corrupt row
UPDATE public.syntage_invoice_payments
   SET fecha_pago = NULL
 WHERE syntage_id = 'a13b06bf-9d0a-4540-bcef-2ccc70a466ab'
   AND fecha_pago = '2029-05-29';

-- Defensive guard: future-proof against Syntage source corruption.
-- 2050 is a generous limit — anything beyond is clearly invalid.
ALTER TABLE public.syntage_invoice_payments
  DROP CONSTRAINT IF EXISTS syntage_invoice_payments_fecha_pago_reasonable;
ALTER TABLE public.syntage_invoice_payments
  ADD  CONSTRAINT syntage_invoice_payments_fecha_pago_reasonable
  CHECK (fecha_pago IS NULL OR fecha_pago <= '2050-01-01'::date);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES
  ('UPDATE', 'syntage_invoice_payments',
   'P1-4 audit: NULL fecha_pago for syntage_id=a13b06bf-9d0a-4540-bcef-2ccc70a466ab (was 2029-05-29, source corruption)',
   'supabase/migrations/20260428_p1_4_syntage_2029_fecha_pago_fix.sql',
   'audit-2026-04-28-p1-4', true),
  ('ADD_CONSTRAINT', 'syntage_invoice_payments',
   'P1-4 audit: CHECK fecha_pago <= 2050-01-01 (defensive against future Syntage corruption)',
   'supabase/migrations/20260428_p1_4_syntage_2029_fecha_pago_fix.sql',
   'audit-2026-04-28-p1-4', true);

COMMIT;
