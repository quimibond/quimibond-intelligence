-- Fase 5 · 008 email_cfdi_links table + invoices_unified MV rebuild
-- Crea tabla vacía (se popula en PR 4) + recrea MV con LEFT JOIN para poblar email_id_origen.

CREATE TABLE IF NOT EXISTS public.email_cfdi_links (
  id           bigserial PRIMARY KEY,
  email_id     bigint,
  gmail_message_id text,
  account      text,
  uuid         text NOT NULL,
  linked_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_cfdi_links_uuid_idx  ON public.email_cfdi_links(uuid);
CREATE INDEX IF NOT EXISTS email_cfdi_links_email_idx ON public.email_cfdi_links(email_id);

ALTER TABLE public.email_cfdi_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_cfdi_links FROM anon, authenticated;
GRANT ALL ON public.email_cfdi_links TO service_role;

COMMENT ON TABLE public.email_cfdi_links IS 'Fase 5 · Puente email↔CFDI (schema reducido). Reemplaza cfdi_documents. Populated en PR 4.';

-- Recreate invoices_unified con LEFT JOIN a email_cfdi_links para populate email_id_origen
-- Copia exacta del MV actual + una nueva LEFT JOIN + columna cambia de NULL::bigint a el.email_id
DROP MATERIALIZED VIEW IF EXISTS public.invoices_unified CASCADE;

CREATE MATERIALIZED VIEW public.invoices_unified AS
WITH
  uuid_matches AS (
    SELECT DISTINCT ON (s.uuid)
      s.uuid AS uuid_sat, o.id AS odoo_invoice_id,
      COUNT(*) OVER (PARTITION BY s.uuid) AS n_odoo_candidates
    FROM public.syntage_invoices s
    JOIN public.odoo_invoices o
      ON o.cfdi_uuid = s.uuid AND o.odoo_company_id = s.odoo_company_id
    WHERE s.tipo_comprobante IN ('I','E')
      AND o.move_type IN ('out_invoice','out_refund','in_invoice','in_refund')
    ORDER BY s.uuid, o.invoice_date DESC NULLS LAST, o.id DESC
  ),
  composite_candidates AS (
    SELECT
      s.uuid AS uuid_sat, o.id AS odoo_invoice_id,
      COUNT(*) OVER (PARTITION BY s.uuid) AS n_candidates,
      ROW_NUMBER() OVER (PARTITION BY s.uuid ORDER BY o.invoice_date) AS rn
    FROM public.syntage_invoices s
    JOIN public.companies c ON lower(c.rfc) = lower(COALESCE(s.emisor_rfc, s.receptor_rfc))
    JOIN public.odoo_invoices o
      ON o.company_id = c.id
     AND abs(s.total - o.amount_total) < 0.01
     AND date(s.fecha_emision) = date(o.invoice_date)
     AND (COALESCE(s.serie,'') || COALESCE(s.folio,'') ILIKE '%' || o.ref || '%'
       OR o.ref ILIKE '%' || COALESCE(s.folio,'') || '%')
     AND o.odoo_company_id = s.odoo_company_id
     AND o.move_type IN ('out_invoice','out_refund','in_invoice','in_refund')
    WHERE s.tipo_comprobante IN ('I','E')
      AND NOT EXISTS (SELECT 1 FROM uuid_matches u WHERE u.uuid_sat = s.uuid)
      AND o.ref IS NOT NULL AND o.ref <> ''
  ),
  composite_matches AS (
    SELECT uuid_sat, odoo_invoice_id, n_candidates
    FROM composite_candidates WHERE rn = 1
  ),
  paired AS (
    SELECT uuid_sat, odoo_invoice_id, 'match_uuid'::text AS match_status,
      CASE WHEN n_odoo_candidates > 1 THEN 'medium' ELSE 'high' END AS match_quality
    FROM uuid_matches
    UNION ALL
    SELECT uuid_sat, odoo_invoice_id,
      CASE WHEN n_candidates > 1 THEN 'ambiguous' ELSE 'match_composite' END,
      CASE WHEN n_candidates > 1 THEN 'low' ELSE 'medium' END
    FROM composite_matches
  )
SELECT
  COALESCE(s.uuid, 'odoo:' || o.id::text) AS canonical_id,
  s.uuid AS uuid_sat, o.id AS odoo_invoice_id,
  COALESCE(p.match_status,
    CASE WHEN s.uuid IS NOT NULL AND o.id IS NULL THEN 'syntage_only'
         WHEN s.uuid IS NULL AND o.id IS NOT NULL THEN 'odoo_only' END) AS match_status,
  COALESCE(p.match_quality, 'n/a') AS match_quality,
  COALESCE(s.direction, CASE WHEN o.move_type LIKE 'out_%' THEN 'issued' ELSE 'received' END) AS direction,
  s.estado_sat, s.fecha_cancelacion, s.fecha_timbrado, s.tipo_comprobante,
  s.metodo_pago, s.forma_pago, s.uso_cfdi,
  s.emisor_rfc, s.emisor_nombre, s.receptor_rfc, s.receptor_nombre,
  s.emisor_blacklist_status, s.receptor_blacklist_status,
  s.total AS total_fiscal, s.subtotal AS subtotal_fiscal, s.descuento AS descuento_fiscal,
  s.impuestos_trasladados, s.impuestos_retenidos,
  s.moneda AS moneda_fiscal, s.tipo_cambio AS tipo_cambio_fiscal, s.total_mxn AS total_mxn_fiscal,
  COALESCE(s.odoo_company_id, o.odoo_company_id) AS odoo_company_id,
  o.company_id, c.name AS partner_name, o.odoo_partner_id,
  o.name AS odoo_ref, o.ref AS odoo_external_ref, o.move_type AS odoo_move_type,
  o.state AS odoo_state, o.payment_state,
  o.amount_total AS odoo_amount_total, o.amount_residual,
  o.invoice_date, o.due_date, o.days_overdue, o.currency AS odoo_currency,
  CASE
    WHEN s.uuid IS NULL OR o.id IS NULL THEN NULL
    WHEN s.estado_sat = 'cancelado' AND o.state = 'posted' THEN 'cancelled_but_posted'
    WHEN abs(s.total - o.amount_total) > 0.01 THEN 'amount_mismatch'
    ELSE 'consistent'
  END AS fiscal_operational_consistency,
  (s.total - o.amount_total) AS amount_diff,
  el.email_id AS email_id_origen,
  now() AS refreshed_at
FROM paired p
FULL OUTER JOIN public.syntage_invoices s ON s.uuid = p.uuid_sat
FULL OUTER JOIN public.odoo_invoices    o ON o.id   = p.odoo_invoice_id
LEFT JOIN public.companies c ON c.id = o.company_id
LEFT JOIN LATERAL (
  SELECT email_id FROM public.email_cfdi_links WHERE uuid = s.uuid LIMIT 1
) el ON true
WHERE
  (s.tipo_comprobante IN ('I','E') OR s.tipo_comprobante IS NULL)
  AND (o.move_type IN ('out_invoice','out_refund','in_invoice','in_refund') OR o.move_type IS NULL)
  AND (s.uuid IS NOT NULL OR o.id IS NOT NULL);

CREATE UNIQUE INDEX invoices_unified_canonical_id_idx ON public.invoices_unified (canonical_id);
CREATE INDEX invoices_unified_company_date_idx  ON public.invoices_unified (odoo_company_id, fecha_timbrado DESC NULLS LAST);
CREATE INDEX invoices_unified_match_status_idx  ON public.invoices_unified (match_status);
CREATE INDEX invoices_unified_consistency_idx   ON public.invoices_unified (fiscal_operational_consistency) WHERE fiscal_operational_consistency IS NOT NULL;
CREATE INDEX invoices_unified_cancelled_idx     ON public.invoices_unified (estado_sat) WHERE estado_sat = 'cancelado';
CREATE INDEX invoices_unified_direction_idx     ON public.invoices_unified (direction, fecha_timbrado DESC NULLS LAST);
CREATE INDEX invoices_unified_email_id_idx      ON public.invoices_unified (email_id_origen) WHERE email_id_origen IS NOT NULL;

REVOKE ALL ON public.invoices_unified FROM anon, authenticated;
GRANT SELECT ON public.invoices_unified TO service_role;

COMMENT ON MATERIALIZED VIEW public.invoices_unified IS 'Fase 3 · Layer 3 canónico: 1 row por CFDI (I/E). Fase 5 · agrega email_id_origen via LEFT JOIN email_cfdi_links.';
