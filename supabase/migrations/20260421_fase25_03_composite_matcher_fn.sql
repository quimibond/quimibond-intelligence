BEGIN;

CREATE OR REPLACE FUNCTION public.match_unlinked_invoices_by_composite(
  p_batch_size integer DEFAULT 500,
  p_date_tolerance_days integer DEFAULT 3,
  p_amount_tolerance numeric DEFAULT 0.01
) RETURNS TABLE (
  odoo_invoice_id bigint,
  syntage_uuid text,
  emisor_rfc text,
  amount_mxn numeric,
  invoice_date date,
  match_confidence text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH odoo_unmatched AS (
    SELECT o.id AS odoo_id, o.cfdi_uuid, o.amount_total_mxn, o.invoice_date,
           -- PNT920218IW5 is the verified Quimibond RFC (confirmed 2026-04-20)
           CASE WHEN o.move_type IN ('out_invoice','out_refund') THEN 'PNT920218IW5' ELSE NULL END AS emisor_if_customer,
           o.odoo_partner_id
    FROM public.odoo_invoices o
    WHERE o.state='posted'
      AND o.cfdi_uuid IS NULL
      AND o.invoice_date >= '2021-01-01'
  ),
  syntage_unmatched AS (
    SELECT s.uuid, s.emisor_rfc, s.total_mxn, s.fecha_timbrado::date AS fecha,
           s.direction
    FROM public.syntage_invoices s
    WHERE s.fecha_timbrado >= '2021-01-01'
      AND NOT EXISTS (SELECT 1 FROM public.odoo_invoices o2 WHERE o2.cfdi_uuid = s.uuid)
  )
  SELECT ou.odoo_id,
         su.uuid,
         su.emisor_rfc,
         su.total_mxn,
         ou.invoice_date,
         CASE
           WHEN su.total_mxn = ou.amount_total_mxn AND su.fecha = ou.invoice_date THEN 'high'
           WHEN abs(su.total_mxn - ou.amount_total_mxn) <= p_amount_tolerance
                AND abs(su.fecha - ou.invoice_date) <= p_date_tolerance_days THEN 'medium'
           ELSE 'low'
         END
  FROM odoo_unmatched ou
  JOIN syntage_unmatched su ON (
    abs(su.total_mxn - ou.amount_total_mxn) <= p_amount_tolerance
    AND abs(su.fecha - ou.invoice_date) <= p_date_tolerance_days
  )
  LIMIT p_batch_size;
END $$;

COMMENT ON FUNCTION public.match_unlinked_invoices_by_composite IS
  'Sugiere matches operativo↔fiscal por composite (amount_mxn + date tolerance). Diagnóstico — no aplica auto-links.';

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed)
VALUES ('create_function', 'match_unlinked_invoices_by_composite(int,int,numeric)', 'Fase 2.5 — composite matcher para diagnóstico', 'CREATE OR REPLACE FUNCTION match_unlinked_invoices_by_composite(p_batch_size int, p_date_tolerance_days int, p_amount_tolerance numeric) RETURNS TABLE(odoo_invoice_id bigint, syntage_uuid text, ...)');

COMMIT;
