-- SP3 Task 2: Populate canonical_companies from Odoo companies
-- Dry-run preview (2026-04-20):
--   total=2197, with_rfc=1375, with_odoo_id=2197, customers=1653, suppliers=603
--   distinct canonical_names=2197 (no duplicates — ON CONFLICT DO NOTHING drops 0)
-- canonical_invoices rows: 88,462 | canonical_credit_notes rows: 2,208
-- Strategy: single migration file (Steps 2a + 3 combined for atomicity)
-- If apply_migration times out, Step 3 metrics can be re-run via execute_sql.

BEGIN;

-- ─────────────────────────────────────────────
-- 2a. Insert rows from companies
-- ─────────────────────────────────────────────
INSERT INTO canonical_companies (
  canonical_name, display_name,
  rfc, odoo_partner_id, primary_entity_kg_id, primary_email_domain,
  is_customer, is_supplier, is_internal,
  country, city,
  industry, business_type,
  credit_limit, payment_term, supplier_payment_term,
  description, strategic_notes, relationship_type, relationship_summary,
  key_products, risk_signals, opportunity_signals,
  enriched_at, enrichment_source,
  lifetime_value_mxn, total_invoiced_odoo_mxn,
  total_receivable_mxn, total_payable_mxn, total_pending_mxn,
  total_credit_notes_mxn,
  trend_pct, otd_rate,
  match_method, match_confidence,
  last_matched_at
)
SELECT
  c.canonical_name,
  c.name,
  NULLIF(TRIM(c.rfc), ''),
  c.odoo_partner_id,
  c.entity_id,
  LOWER(NULLIF(TRIM(c.domain), '')),
  COALESCE(c.is_customer, false),
  COALESCE(c.is_supplier, false),
  (c.rfc = 'PNT920218IW5' AND c.id = 6707),
  c.country, c.city,
  c.industry, c.business_type,
  c.credit_limit, c.payment_term, c.supplier_payment_term,
  c.description, c.strategic_notes, c.relationship_type, c.relationship_summary,
  c.key_products, c.risk_signals, c.opportunity_signals,
  c.enriched_at, c.enrichment_source,
  COALESCE(c.lifetime_value, 0),       COALESCE(c.total_invoiced_odoo, 0),
  COALESCE(c.total_receivable, 0),     COALESCE(c.total_payable, 0),     COALESCE(c.total_pending, 0),
  COALESCE(c.total_credit_notes, 0),
  c.trend_pct, c.delivery_otd_rate,
  CASE
    WHEN c.odoo_partner_id IS NOT NULL AND c.rfc IS NOT NULL THEN 'odoo_partner_id+rfc'
    WHEN c.odoo_partner_id IS NOT NULL                       THEN 'odoo_partner_id'
    WHEN c.rfc IS NOT NULL                                   THEN 'rfc_exact'
    ELSE 'odoo_only'
  END AS match_method,
  CASE
    WHEN c.odoo_partner_id IS NOT NULL AND c.rfc IS NOT NULL THEN 1.000
    WHEN c.odoo_partner_id IS NOT NULL                       THEN 0.99
    WHEN c.rfc IS NOT NULL                                   THEN 0.99
    ELSE 0.80
  END AS match_confidence,
  now()
FROM companies c
ON CONFLICT (canonical_name) DO NOTHING;

-- ─────────────────────────────────────────────
-- 3a. Retroactive metrics — invoice aggregates
-- ─────────────────────────────────────────────
WITH agg AS (
  SELECT
    ci.receptor_company_id                                                                AS company_id,
    SUM(ci.amount_total_mxn_resolved)                                                     AS lifetime_value_mxn,
    SUM(ci.amount_total_mxn_odoo)                                                         AS total_invoiced_odoo_mxn,
    SUM(ci.amount_total_mxn_sat)                                                          AS total_invoiced_sat_mxn,
    SUM(CASE WHEN ci.invoice_date >= (CURRENT_DATE - INTERVAL '90 days')
             THEN ci.amount_total_mxn_resolved ELSE 0 END)                               AS revenue_90d_mxn,
    SUM(CASE WHEN ci.invoice_date >= (CURRENT_DATE - INTERVAL '180 days')
             AND  ci.invoice_date <  (CURRENT_DATE - INTERVAL '90 days')
             THEN ci.amount_total_mxn_resolved ELSE 0 END)                               AS revenue_prior_90d_mxn,
    SUM(CASE WHEN date_trunc('year', ci.invoice_date) = date_trunc('year', CURRENT_DATE)
             THEN ci.amount_total_mxn_resolved ELSE 0 END)                               AS revenue_ytd_mxn,
    SUM(CASE WHEN ci.move_type_odoo = 'out_invoice'
             THEN ci.amount_residual_mxn_resolved ELSE 0 END)                            AS total_receivable_mxn,
    SUM(CASE WHEN ci.move_type_odoo = 'in_invoice'
             THEN ci.amount_residual_mxn_resolved ELSE 0 END)                            AS total_payable_mxn,
    COUNT(*)                                                                              AS invoices_count,
    MAX(ci.invoice_date)                                                                  AS last_invoice_date,
    COUNT(*) FILTER (WHERE ci.cfdi_uuid_odoo IS NOT NULL OR ci.sat_uuid IS NOT NULL)      AS invoices_with_cfdi,
    COUNT(*) FILTER (WHERE ci.has_sat_record)                                              AS invoices_with_syntage_match
  FROM canonical_invoices ci
  WHERE ci.receptor_company_id IS NOT NULL
  GROUP BY ci.receptor_company_id
)
UPDATE canonical_companies cc
SET
  lifetime_value_mxn          = COALESCE(agg.lifetime_value_mxn, 0),
  total_invoiced_odoo_mxn     = COALESCE(agg.total_invoiced_odoo_mxn, 0),
  total_invoiced_sat_mxn      = COALESCE(agg.total_invoiced_sat_mxn, 0),
  revenue_ytd_mxn             = COALESCE(agg.revenue_ytd_mxn, 0),
  revenue_90d_mxn             = COALESCE(agg.revenue_90d_mxn, 0),
  revenue_prior_90d_mxn       = COALESCE(agg.revenue_prior_90d_mxn, 0),
  trend_pct                   = CASE WHEN agg.revenue_prior_90d_mxn > 0
                                     THEN ROUND(100.0 * (agg.revenue_90d_mxn - agg.revenue_prior_90d_mxn)
                                                       / agg.revenue_prior_90d_mxn, 4)
                                     ELSE NULL END,
  total_receivable_mxn        = COALESCE(agg.total_receivable_mxn, 0),
  total_payable_mxn           = COALESCE(agg.total_payable_mxn, 0),
  invoices_count              = COALESCE(agg.invoices_count, 0),
  last_invoice_date           = agg.last_invoice_date,
  invoices_with_cfdi          = COALESCE(agg.invoices_with_cfdi, 0),
  invoices_with_syntage_match = COALESCE(agg.invoices_with_syntage_match, 0),
  sat_compliance_score        = CASE WHEN agg.invoices_with_cfdi > 0
                                     THEN ROUND(agg.invoices_with_syntage_match::numeric
                                                / agg.invoices_with_cfdi, 4)
                                     ELSE NULL END
FROM agg
JOIN companies c ON c.id = agg.company_id
WHERE cc.canonical_name = c.canonical_name;

-- ─────────────────────────────────────────────
-- 3b. Retroactive metrics — credit notes
-- ─────────────────────────────────────────────
WITH cn_agg AS (
  SELECT
    ccn.receptor_company_id    AS company_id,
    SUM(ccn.amount_total_mxn_resolved) AS total_credit_notes_mxn
  FROM canonical_credit_notes ccn
  WHERE ccn.receptor_company_id IS NOT NULL
  GROUP BY ccn.receptor_company_id
)
UPDATE canonical_companies cc
SET total_credit_notes_mxn = COALESCE(cn_agg.total_credit_notes_mxn, 0)
FROM cn_agg
JOIN companies c ON c.id = cn_agg.company_id
WHERE cc.canonical_name = c.canonical_name;

-- ─────────────────────────────────────────────
-- 3c. Retroactive metrics — contact count
-- ─────────────────────────────────────────────
UPDATE canonical_companies cc
SET contact_count = sub.cnt
FROM (
  SELECT company_id, COUNT(*) AS cnt
  FROM contacts
  WHERE company_id IS NOT NULL
  GROUP BY company_id
) sub
JOIN companies c ON c.id = sub.company_id
WHERE cc.canonical_name = c.canonical_name;

-- ─────────────────────────────────────────────
-- Audit log
-- ─────────────────────────────────────────────
INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES (
  'populate',
  'canonical_companies',
  'SP3 Task 2: populate from companies (Quimibond id=6707 marked is_internal=true). 2197 rows, 0 canonical_name dupes. Retroactive metrics from canonical_invoices+canonical_credit_notes+contacts.',
  '20260423_sp3_02_canonical_companies_populate_odoo.sql',
  'silver-sp3',
  true
);

COMMIT;
