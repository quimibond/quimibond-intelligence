-- Fix gold_revenue_monthly: exclude any invoice cancelled at SAT regardless
-- of state_odoo. Previous filter only caught state_mismatch=true AND
-- state_odoo='posted' AND estado_sat='cancelado', missing the case where
-- state_odoo IS NULL (e.g. SAT-only canonical invoices). 5 invoices in
-- mar-2026 ($1.67M) were leaking through.
--
-- Applied via supabase MCP apply_migration on 2026-04-30 by Claude.
-- Mar-2026 grand total dropped $31.16M → $29.49M (−$1.67M) post-fix.
CREATE OR REPLACE VIEW gold_revenue_monthly AS
WITH issued AS (
  SELECT
    date_trunc('month', canonical_invoices.invoice_date_resolved::timestamp with time zone)::date AS month_start,
    canonical_invoices.receptor_canonical_company_id AS company_id,
    sum(canonical_invoices.amount_total_mxn_odoo)         AS odoo_mxn,
    sum(canonical_invoices.amount_total_mxn_sat)          AS sat_mxn,
    sum(canonical_invoices.amount_total_mxn_resolved)     AS resolved_mxn,
    count(*)                                              AS invoices_count,
    sum(canonical_invoices.amount_residual_mxn_resolved)  AS residual_mxn
  FROM canonical_invoices
  WHERE canonical_invoices.direction = 'issued'::text
    AND canonical_invoices.invoice_date_resolved IS NOT NULL
    AND COALESCE(canonical_invoices.estado_sat, 'vigente') <> 'cancelado'
  GROUP BY
    (date_trunc('month', canonical_invoices.invoice_date_resolved::timestamp with time zone)::date),
    canonical_invoices.receptor_canonical_company_id
)
SELECT
  issued.month_start,
  issued.company_id AS canonical_company_id,
  cc.display_name   AS company_name,
  issued.odoo_mxn,
  issued.sat_mxn,
  issued.resolved_mxn,
  issued.residual_mxn,
  issued.invoices_count,
  CASE
    WHEN issued.odoo_mxn IS NOT NULL AND issued.sat_mxn IS NULL THEN 'odoo_only'::text
    WHEN issued.odoo_mxn IS NULL AND issued.sat_mxn IS NOT NULL THEN 'sat_only'::text
    ELSE 'dual_source'::text
  END AS source_pattern,
  now() AS refreshed_at
FROM issued
LEFT JOIN canonical_companies cc ON cc.id = issued.company_id;
