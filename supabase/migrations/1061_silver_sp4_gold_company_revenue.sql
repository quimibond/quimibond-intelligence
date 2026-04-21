-- supabase/migrations/1061_silver_sp4_gold_company_revenue.sql
--
-- Silver SP4 — Task 21: gold_company_360 + gold_revenue_monthly
-- Spec §3.3, §13.1; Plan Task 21.

BEGIN;

DROP VIEW IF EXISTS gold_company_360;

CREATE VIEW gold_company_360 AS
SELECT
  cc.id                         AS canonical_company_id,
  cc.display_name,
  cc.canonical_name,
  cc.rfc,
  cc.is_customer,
  cc.is_supplier,
  cc.is_internal,
  cc.blacklist_level,
  cc.blacklist_action,
  cc.has_shadow_flag,
  cc.has_manual_override,
  cc.risk_level,
  cc.tier,
  cc.total_receivable_mxn,
  cc.total_payable_mxn,
  cc.total_pending_mxn,
  cc.overdue_amount_mxn,
  cc.overdue_count,
  cc.max_days_overdue,
  cc.ar_aging_buckets,
  cc.lifetime_value_mxn,
  cc.revenue_ytd_mxn,
  cc.revenue_90d_mxn,
  cc.revenue_prior_90d_mxn,
  cc.trend_pct,
  cc.revenue_share_pct,
  cc.invoices_count,
  cc.last_invoice_date,
  cc.total_deliveries_count,
  cc.late_deliveries_count,
  cc.otd_rate,
  cc.otd_rate_90d,
  cc.sat_compliance_score,
  cc.invoices_with_cfdi,
  cc.invoices_with_syntage_match,
  cc.sat_open_issues_count,
  cc.opinion_cumplimiento,
  cc.email_count,
  cc.last_email_at,
  cc.contact_count,
  (SELECT COUNT(*) FROM reconciliation_issues ri
     WHERE ri.canonical_entity_type = 'company'
       AND ri.canonical_entity_id = cc.id::text
       AND ri.resolved_at IS NULL)                  AS open_company_issues_count,
  (SELECT COUNT(*) FROM canonical_sale_orders so
     WHERE so.canonical_company_id = cc.id
       AND so.state IN ('sale','done')
       AND so.date_order >= CURRENT_DATE - interval '365 days') AS sales_orders_12m,
  (SELECT COUNT(*) FROM canonical_purchase_orders po
     WHERE po.canonical_company_id = cc.id
       AND po.state IN ('purchase','done')
       AND po.date_order >= CURRENT_DATE - interval '365 days') AS purchase_orders_12m,
  cc.key_products,
  cc.risk_signals,
  cc.opportunity_signals,
  cc.enriched_at,
  cc.relationship_type,
  cc.relationship_summary,
  cc.updated_at                                AS last_data_refresh_at,
  now()                                        AS refreshed_at
FROM canonical_companies cc;

COMMENT ON VIEW gold_company_360 IS
  'Unified company profile for /companies/[id] SP5. Customer/supplier/internal join-point.';

DROP VIEW IF EXISTS gold_revenue_monthly;

CREATE VIEW gold_revenue_monthly AS
WITH issued AS (
  SELECT date_trunc('month', invoice_date)::date AS month_start,
         receptor_canonical_company_id AS company_id,
         SUM(amount_total_mxn_odoo)     AS odoo_mxn,
         SUM(amount_total_mxn_sat)      AS sat_mxn,
         SUM(amount_total_mxn_resolved) AS resolved_mxn,
         COUNT(*)                        AS invoices_count,
         SUM(amount_residual_mxn_resolved) AS residual_mxn
  FROM canonical_invoices
  WHERE direction='issued' AND invoice_date IS NOT NULL
  GROUP BY 1, 2
)
SELECT
  issued.month_start,
  issued.company_id                          AS canonical_company_id,
  cc.display_name                            AS company_name,
  issued.odoo_mxn,
  issued.sat_mxn,
  issued.resolved_mxn,
  issued.residual_mxn,
  issued.invoices_count,
  CASE
    WHEN issued.odoo_mxn IS NOT NULL AND issued.sat_mxn IS NULL THEN 'odoo_only'
    WHEN issued.odoo_mxn IS NULL AND issued.sat_mxn IS NOT NULL THEN 'sat_only'
    ELSE 'dual_source'
  END                                        AS source_pattern,
  now()                                      AS refreshed_at
FROM issued
LEFT JOIN canonical_companies cc ON cc.id = issued.company_id;

COMMENT ON VIEW gold_revenue_monthly IS
  'Monthly revenue per company per source. direction=issued only. NULL company_id = orphan.';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE_VIEW', 'gold_company_360', 'Gold: company 360 profile',
       'supabase/migrations/1061_silver_sp4_gold_company_revenue.sql', 'silver-sp4-task-21', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes
                  WHERE triggered_by='silver-sp4-task-21' AND table_name='gold_company_360');

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE_VIEW', 'gold_revenue_monthly', 'Gold: monthly revenue',
       'supabase/migrations/1061_silver_sp4_gold_company_revenue.sql', 'silver-sp4-task-21', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes
                  WHERE triggered_by='silver-sp4-task-21' AND table_name='gold_revenue_monthly');

COMMIT;
