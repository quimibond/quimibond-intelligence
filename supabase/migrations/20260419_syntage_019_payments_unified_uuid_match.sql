-- Syntage · payments_unified con match via invoice UUID (usa link table)
--
-- Context: num_operacion match no funciona (odoo_account_payments.ref está
-- vacío en el 100% de las filas). Composite bank match tampoco (Syntage no
-- expone banco). Pero TODA Syntage payment trae doctos_relacionados[].uuid_docto
-- (CFDI UUID de la factura pagada) → podemos saltar a Odoo via:
--
--   Syntage.uuid_docto → odoo_invoices.cfdi_uuid → odoo_invoice_id
--   → odoo_payment_invoice_links.odoo_payment_id → odoo_account_payments
--
-- Match quality:
--   - high: TODOS los doctos del Syntage resuelven al MISMO odoo_payment
--   - medium: MAYORÍA de doctos resuelven al mismo odoo_payment (≥50%)
--   - num_op fallback: sobrevive como Nivel 1 para cuando Odoo populé ref
--
-- Requiere: migration 018 (odoo_payment_invoice_links) + qb19
-- _push_payment_invoice_links corrido al menos una vez.

DROP VIEW IF EXISTS public.payment_allocations_unified CASCADE;
DROP MATERIALIZED VIEW IF EXISTS public.payments_unified CASCADE;

CREATE MATERIALIZED VIEW public.payments_unified AS
WITH
  -- Nivel 0: match via UUID de doctos_relacionados → link table
  -- Por cada syntage payment, contamos cuántos de sus doctos apuntan a cada
  -- posible odoo_payment. El que más comparte gana.
  uuid_candidates AS (
    SELECT
      s.uuid_complemento,
      pil.odoo_payment_id,
      COUNT(*)                    AS shared_doctos,
      s_doctos.total_doctos       AS syntage_total_doctos
    FROM public.syntage_invoice_payments s
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.doctos_relacionados, '[]'::jsonb)) AS doc
    JOIN public.odoo_invoices oi
      ON lower(oi.cfdi_uuid) = lower(doc->>'uuid_docto')
     AND oi.odoo_company_id = s.odoo_company_id
    JOIN public.odoo_payment_invoice_links pil
      ON pil.odoo_invoice_id = oi.odoo_invoice_id
     AND oi.odoo_invoice_id IS NOT NULL
     AND pil.odoo_company_id = s.odoo_company_id
    CROSS JOIN LATERAL (
      SELECT jsonb_array_length(COALESCE(s.doctos_relacionados, '[]'::jsonb)) AS total_doctos
    ) s_doctos
    WHERE s.doctos_relacionados IS NOT NULL
      AND jsonb_array_length(s.doctos_relacionados) > 0
    GROUP BY s.uuid_complemento, pil.odoo_payment_id, s_doctos.total_doctos
  ),
  uuid_matches AS (
    SELECT DISTINCT ON (uc.uuid_complemento)
      uc.uuid_complemento,
      oap.id AS odoo_payment_id,
      uc.shared_doctos,
      uc.syntage_total_doctos,
      CASE
        WHEN uc.shared_doctos = uc.syntage_total_doctos THEN 'high'
        WHEN uc.shared_doctos::float / NULLIF(uc.syntage_total_doctos, 0) >= 0.5 THEN 'medium'
        ELSE 'low'
      END AS match_quality
    FROM uuid_candidates uc
    JOIN public.odoo_account_payments oap ON oap.odoo_payment_id = uc.odoo_payment_id
    ORDER BY uc.uuid_complemento, uc.shared_doctos DESC, oap.date DESC NULLS LAST
  ),
  -- Nivel 1: num_operacion (fallback si Odoo empieza a populé ref)
  num_op_matches AS (
    SELECT DISTINCT ON (s.uuid_complemento)
      s.uuid_complemento,
      o.id AS odoo_payment_id,
      'medium'::text AS match_quality
    FROM public.syntage_invoice_payments s
    JOIN public.odoo_account_payments o
      ON o.ref = s.num_operacion
     AND o.odoo_company_id = s.odoo_company_id
    WHERE s.num_operacion IS NOT NULL AND s.num_operacion <> ''
      AND NOT EXISTS (SELECT 1 FROM uuid_matches um WHERE um.uuid_complemento = s.uuid_complemento)
    ORDER BY s.uuid_complemento, o.date DESC NULLS LAST, o.id DESC
  ),
  paired AS (
    SELECT uuid_complemento, odoo_payment_id,
           'match_uuid'::text AS match_status, match_quality
    FROM uuid_matches
    UNION ALL
    SELECT uuid_complemento, odoo_payment_id,
           'match_num_op'::text AS match_status, match_quality
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
  s.fecha_pago, s.forma_pago_p, s.num_operacion, s.moneda_p, s.tipo_cambio_p, s.monto,
  s.rfc_emisor_cta_ord, s.rfc_emisor_cta_ben, s.estado_sat, s.doctos_relacionados,
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

CREATE OR REPLACE VIEW public.unified_payment_allocations AS
  SELECT * FROM public.payment_allocations_unified;
GRANT SELECT ON public.unified_payment_allocations TO service_role, authenticated;

COMMENT ON MATERIALIZED VIEW public.payments_unified IS
  '1 row por complemento Tipo P. Match primario via UUID de doctos_relacionados '
  '→ odoo_invoices.cfdi_uuid → odoo_payment_invoice_links → odoo_account_payments. '
  'Fallback: num_operacion (sólo activo si Odoo populé account.payment.ref).';
