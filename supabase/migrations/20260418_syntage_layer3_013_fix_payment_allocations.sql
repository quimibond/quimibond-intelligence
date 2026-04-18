-- Fase 5 · 013 fix: recreate payment_allocations_unified
-- Bug: T1 migration (008) used DROP MATERIALIZED VIEW invoices_unified CASCADE,
-- que también dropped payment_allocations_unified porque esta VIEW JOIN-ea
-- invoices_unified para popular invoice_canonical_id.
--
-- Síntoma: pg_cron 'refresh-syntage-unified' y 'debounced-unified-refresh'
-- fallaron con `relation "public.payment_allocations_unified" does not exist`
-- desde 2026-04-18 00:15 UTC. Queue acumuló 508 pending.
--
-- Fix: recrear la VIEW con la misma definición original de Fase 3 003.
-- El `CREATE OR REPLACE VIEW` es idempotente — safe to re-run.

CREATE OR REPLACE VIEW public.payment_allocations_unified AS
SELECT
  p.canonical_payment_id,
  p.uuid_complemento,
  p.odoo_payment_id,
  p.direction,
  p.fecha_pago,
  p.odoo_company_id,
  (doc->>'uuid_docto')::text        AS invoice_uuid_sat,
  (doc->>'serie')::text             AS invoice_serie,
  (doc->>'folio')::text             AS invoice_folio,
  (doc->>'parcialidad')::int        AS parcialidad,
  (doc->>'imp_saldo_ant')::numeric  AS imp_saldo_ant,
  (doc->>'imp_pagado')::numeric     AS imp_pagado,
  (doc->>'imp_saldo_insoluto')::numeric AS imp_saldo_insoluto,
  iu.canonical_id                   AS invoice_canonical_id
FROM public.payments_unified p
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.doctos_relacionados, '[]'::jsonb)) AS doc
LEFT JOIN public.invoices_unified iu ON iu.uuid_sat = (doc->>'uuid_docto')::text;

REVOKE ALL ON public.payment_allocations_unified FROM anon, authenticated;
GRANT SELECT ON public.payment_allocations_unified TO service_role;

COMMENT ON VIEW public.payment_allocations_unified IS
  'Fase 3 · Expande doctos_relacionados de payments_unified → 1 row por allocation. '
  'Recreada en Fase 5 013 tras CASCADE accidental al rebuild invoices_unified.';

-- Futuro: cuando se vuelva a rebuild invoices_unified, incluir la recreación
-- de esta VIEW en la misma migración (o evitar CASCADE y dropear dependientes
-- explícitamente antes).
