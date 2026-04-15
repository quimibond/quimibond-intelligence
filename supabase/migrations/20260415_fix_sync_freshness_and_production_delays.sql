-- =========================================================================
-- Audit 2026-04-15 — follow up fixes
--
-- Fix 1: odoo_sync_freshness was using MAX(synced_at) from each table, which
-- only updates when a row is INSERTed/UPDATEd. For nearly-static tables like
-- odoo_chart_of_accounts (1,557 rows, rarely changes), the sync correctly
-- runs every hour with 0 row changes, so `synced_at` never bumps and the view
-- reported the table as "warning" 36+ hours stale. This was a false alarm.
--
-- Fix: COALESCE with odoo_push_last_events.created_at (time when the push
-- method last RAN successfully, regardless of whether rows changed).
-- Also adds mrp_boms to the freshness check since it's already being synced.
--
-- Fix 2: New `production_delays` view joins odoo_manufacturing with the
-- source sale order (via the `origin` field, which Odoo populates with the
-- SO name for MTO productions). Gives the Director de Operaciones commercial
-- context for every late production: which client is affected, what's the
-- revenue, which salesperson owns it. Audit found Operaciones was seeing
-- MRP orders without any link to the commercial side.
-- =========================================================================

CREATE OR REPLACE VIEW public.odoo_sync_freshness AS
WITH per_table AS (
  SELECT 'odoo_sale_orders'::text AS table_name, 'sale_orders'::text AS push_method, 2 AS expected_hours,
    (SELECT COUNT(*) FROM odoo_sale_orders)::bigint AS row_count,
    (SELECT MAX(synced_at) FROM odoo_sale_orders) AS row_last_sync
  UNION ALL
  SELECT 'odoo_purchase_orders', 'purchase_orders', 2,
    (SELECT COUNT(*) FROM odoo_purchase_orders),
    (SELECT MAX(synced_at) FROM odoo_purchase_orders)
  UNION ALL
  SELECT 'odoo_invoices', 'invoices', 2,
    (SELECT COUNT(*) FROM odoo_invoices),
    (SELECT MAX(synced_at) FROM odoo_invoices)
  UNION ALL
  SELECT 'odoo_invoice_lines', 'invoice_lines', 2,
    (SELECT COUNT(*) FROM odoo_invoice_lines),
    (SELECT MAX(synced_at) FROM odoo_invoice_lines)
  UNION ALL
  SELECT 'odoo_payments', 'payments', 2,
    (SELECT COUNT(*) FROM odoo_payments),
    (SELECT MAX(synced_at) FROM odoo_payments)
  UNION ALL
  SELECT 'odoo_account_payments', 'account_payments', 2,
    (SELECT COUNT(*) FROM odoo_account_payments),
    (SELECT MAX(synced_at) FROM odoo_account_payments)
  UNION ALL
  SELECT 'odoo_deliveries', 'deliveries', 2,
    (SELECT COUNT(*) FROM odoo_deliveries),
    (SELECT MAX(synced_at) FROM odoo_deliveries)
  UNION ALL
  SELECT 'odoo_products', 'products', 6,
    (SELECT COUNT(*) FROM odoo_products),
    (SELECT MAX(updated_at) FROM odoo_products)
  UNION ALL
  SELECT 'odoo_crm_leads', 'crm_leads', 6,
    (SELECT COUNT(*) FROM odoo_crm_leads),
    (SELECT MAX(synced_at) FROM odoo_crm_leads)
  UNION ALL
  SELECT 'odoo_activities', 'activities', 2,
    (SELECT COUNT(*) FROM odoo_activities),
    (SELECT MAX(synced_at) FROM odoo_activities)
  UNION ALL
  SELECT 'odoo_users', 'users', 6,
    (SELECT COUNT(*) FROM odoo_users),
    (SELECT MAX(updated_at) FROM odoo_users)
  UNION ALL
  SELECT 'odoo_employees', 'employees', 6,
    (SELECT COUNT(*) FROM odoo_employees),
    (SELECT MAX(synced_at) FROM odoo_employees)
  UNION ALL
  SELECT 'odoo_departments', 'departments', 12,
    (SELECT COUNT(*) FROM odoo_departments),
    (SELECT MAX(synced_at) FROM odoo_departments)
  UNION ALL
  SELECT 'odoo_orderpoints', 'orderpoints', 6,
    (SELECT COUNT(*) FROM odoo_orderpoints),
    (SELECT MAX(synced_at) FROM odoo_orderpoints)
  UNION ALL
  SELECT 'odoo_chart_of_accounts', 'chart_of_accounts', 12,
    (SELECT COUNT(*) FROM odoo_chart_of_accounts),
    (SELECT MAX(synced_at) FROM odoo_chart_of_accounts)
  UNION ALL
  SELECT 'odoo_account_balances', 'account_balances', 2,
    (SELECT COUNT(*) FROM odoo_account_balances),
    (SELECT MAX(synced_at) FROM odoo_account_balances)
  UNION ALL
  SELECT 'odoo_bank_balances', 'bank_balances', 2,
    (SELECT COUNT(*) FROM odoo_bank_balances),
    (SELECT MAX(updated_at) FROM odoo_bank_balances)
  UNION ALL
  SELECT 'odoo_manufacturing', 'manufacturing', 6,
    (SELECT COUNT(*) FROM odoo_manufacturing),
    (SELECT MAX(synced_at) FROM odoo_manufacturing)
  UNION ALL
  SELECT 'mrp_boms', 'boms', 12,
    (SELECT COUNT(*) FROM mrp_boms),
    (SELECT MAX(synced_at) FROM mrp_boms)
),
last_events AS (
  SELECT method, MAX(created_at) AS last_successful_run
  FROM odoo_push_last_events
  WHERE status = 'success'
  GROUP BY method
),
merged AS (
  SELECT pt.*,
    le.last_successful_run,
    -- Prefer the most recent signal of "sync ran": either row actually changed
    -- (row_last_sync) OR push method completed successfully (last_successful_run).
    GREATEST(pt.row_last_sync, le.last_successful_run) AS last_sync
  FROM per_table pt
  LEFT JOIN last_events le ON le.method = pt.push_method
)
SELECT
  table_name,
  row_count,
  last_sync,
  expected_hours,
  (EXTRACT(epoch FROM (now() - last_sync))::bigint / 60) AS minutes_ago,
  EXTRACT(epoch FROM (now() - last_sync)) / 3600::numeric AS hours_ago,
  CASE
    WHEN last_sync IS NULL THEN 'unknown'
    WHEN EXTRACT(epoch FROM (now() - last_sync)) <= ((expected_hours * 3600) * 2)::numeric THEN 'fresh'
    WHEN EXTRACT(epoch FROM (now() - last_sync)) <= ((expected_hours * 3600) * 4)::numeric THEN 'warning'
    ELSE 'stale'
  END AS status
FROM merged
ORDER BY
  CASE
    WHEN last_sync IS NULL THEN 0
    WHEN EXTRACT(epoch FROM (now() - last_sync)) > ((expected_hours * 3600) * 4)::numeric THEN 1
    WHEN EXTRACT(epoch FROM (now() - last_sync)) > ((expected_hours * 3600) * 2)::numeric THEN 2
    ELSE 3
  END,
  last_sync NULLS FIRST;

-- =========================================================================

CREATE OR REPLACE VIEW public.production_delays AS
SELECT
  m.id,
  m.odoo_production_id,
  m.name AS mo_name,
  m.product_name,
  m.qty_planned,
  m.qty_produced,
  m.state,
  m.date_start,
  m.date_finished,
  m.assigned_user,
  m.origin,
  so.id AS sale_order_id,
  so.company_id AS customer_company_id,
  so.salesperson_name,
  so.salesperson_email,
  so.amount_total_mxn AS so_amount_mxn,
  so.date_order AS so_date_order,
  so.commitment_date AS so_commitment_date,
  c.canonical_name AS customer_name,
  CASE
    WHEN m.state IN ('confirmed', 'progress', 'to_close')
         AND m.date_start IS NOT NULL
         AND m.date_start < NOW() THEN true
    ELSE false
  END AS is_overdue,
  CASE
    WHEN m.state = 'done'
         AND m.qty_planned > 0
         AND m.qty_produced < m.qty_planned * 0.98 THEN true
    ELSE false
  END AS is_underproduced,
  CASE
    WHEN m.state = 'done' THEN NULL
    WHEN m.date_start IS NULL THEN NULL
    ELSE EXTRACT(days FROM (NOW() - m.date_start))::int
  END AS days_late
FROM odoo_manufacturing m
LEFT JOIN odoo_sale_orders so ON so.name = m.origin
LEFT JOIN companies c ON c.id = so.company_id
WHERE
  (m.state IN ('draft', 'confirmed', 'progress', 'to_close'))
  OR (m.state = 'done' AND m.date_finished > NOW() - INTERVAL '30 days'
      AND m.qty_planned > 0 AND m.qty_produced < m.qty_planned * 0.98);

COMMENT ON VIEW public.production_delays IS
  'Joins odoo_manufacturing with source sale order to give Operaciones commercial context for overdue/underproduced MRP orders. Audit 2026-04-15.';
