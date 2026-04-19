-- Syntage · payments_unified sin composite match Nivel 2
--
-- Context: El composite match (rfc_emisor_cta_ord/ben + monto + fecha) nunca
-- produce matches porque Syntage devuelve payerBank/beneficiaryBank `[]`
-- vacíos para todo el tenant (verificado: 0/40 webhook rows tienen data de
-- bank). Mantenerlo agrega complejidad sin valor y potencialmente produce
-- falsos positivos si Syntage empieza a poblar parcialmente.
--
-- Esta migration reconstruye payments_unified con SOLO Nivel 1 (num_operacion
-- = o.ref). Si Syntage empieza a exponer bank data en el futuro, restaurar
-- composite_candidates de migration 003 y reejecutar.

DROP VIEW IF EXISTS public.payment_allocations_unified;
DROP MATERIALIZED VIEW IF EXISTS public.payments_unified CASCADE;

CREATE MATERIALIZED VIEW public.payments_unified AS
WITH
  num_op_matches AS (
    SELECT DISTINCT ON (s.uuid_complemento)
      s.uuid_complemento,
      o.id AS odoo_payment_id,
      COUNT(*) OVER (PARTITION BY s.uuid_complemento) AS n_odoo_candidates
    FROM public.syntage_invoice_payments s
    JOIN public.odoo_account_payments o
      ON o.ref = s.num_operacion
     AND o.odoo_company_id = s.odoo_company_id
    WHERE s.num_operacion IS NOT NULL AND s.num_operacion <> ''
    ORDER BY s.uuid_complemento, o.date DESC NULLS LAST, o.id DESC
  ),
  paired AS (
    SELECT uuid_complemento, odoo_payment_id, 'match_num_op'::text AS match_status,
      CASE WHEN n_odoo_candidates > 1 THEN 'medium' ELSE 'high' END AS match_quality
    FROM num_op_matches
  )
SELECT
  COALESCE(s.uuid_complemento, 'odoo:' || o.id::text) AS canonical_payment_id,
  s.uuid_complemento,
  o.id AS odoo_payment_id,
  COALESCE(p.match_status,
    CASE WHEN s.uuid_complemento IS NOT NULL AND o.id IS NULL THEN 'syntage_only'
         WHEN s.uuid_complemento IS NULL AND o.id IS NOT NULL THEN 'odoo_only' END) AS match_status,
  COALESCE(p.match_quality, 'n/a') AS match_quality,
  COALESCE(s.direction, CASE WHEN o.payment_type = 'inbound' THEN 'received' ELSE 'issued' END) AS direction,

  -- Fiscales (Syntage)
  s.fecha_pago, s.forma_pago_p, s.num_operacion, s.moneda_p, s.tipo_cambio_p, s.monto,
  s.rfc_emisor_cta_ord, s.rfc_emisor_cta_ben, s.estado_sat, s.doctos_relacionados,

  -- Operativos (Odoo)
  COALESCE(s.odoo_company_id, o.odoo_company_id) AS odoo_company_id,
  o.company_id, o.odoo_partner_id,
  o.name AS odoo_ref, o.amount AS odoo_amount, o.date AS odoo_date,
  o.journal_name, o.payment_method, o.is_reconciled, o.currency AS odoo_currency,

  now() AS refreshed_at
FROM paired p
FULL OUTER JOIN public.syntage_invoice_payments s ON s.uuid_complemento = p.uuid_complemento
FULL OUTER JOIN public.odoo_account_payments    o ON o.id                = p.odoo_payment_id
WHERE s.uuid_complemento IS NOT NULL OR o.id IS NOT NULL;

CREATE UNIQUE INDEX payments_unified_canonical_idx  ON public.payments_unified (canonical_payment_id);
CREATE INDEX payments_unified_company_date_idx      ON public.payments_unified (odoo_company_id, fecha_pago DESC NULLS LAST);
CREATE INDEX payments_unified_match_status_idx      ON public.payments_unified (match_status);

REVOKE ALL ON public.payments_unified FROM anon, authenticated;
GRANT SELECT ON public.payments_unified TO service_role;

-- Vista derivada: grano allocation (1 row por docto_relacionado)
CREATE VIEW public.payment_allocations_unified AS
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

COMMENT ON MATERIALIZED VIEW public.payments_unified IS
  '1 row por complemento Tipo P. Match SOLO via num_operacion (Nivel 1). '
  'Composite match Nivel 2 removido en migration 017 por ausencia de bank '
  'data en Syntage.';
COMMENT ON VIEW public.payment_allocations_unified IS
  'Expande doctos_relacionados de payments_unified → 1 row por allocation.';
