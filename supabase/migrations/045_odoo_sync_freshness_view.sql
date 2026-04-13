-- Fase 5 del plan "fix-director-data-integrity":
-- View de salud del sync Odoo → Supabase + helpers.
--
-- Causa raiz detectada: los metodos _push_* del addon qb19 (sync_push.py)
-- se ejecutaban dentro de un solo try/except. Uno fallaba y cortaba el resto
-- sin dejar traza clara. Ver commit qb19 1e47499.
--
-- Esta view permite al frontend (/system) mostrar cuando una tabla odoo_*
-- esta stale vs fresca, con thresholds razonables por tabla. Cuando el addon
-- parcheado haga deploy, los eventos odoo_push de pipeline_logs se mezclan
-- con esta view via odoo_push_last_errors.

BEGIN;

-- ── 1. Freshness por tabla ─────────────────────────────────────────────
-- Columna sync_col puede ser synced_at o updated_at segun la tabla
-- (se detecto inconsistencia: products/users/bank_balances usan updated_at).
CREATE OR REPLACE VIEW odoo_sync_freshness AS
WITH per_table AS (
  SELECT 'odoo_sale_orders'::text AS table_name, 2::int AS expected_hours, COUNT(*)::bigint AS row_count, MAX(synced_at) AS last_sync FROM odoo_sale_orders
  UNION ALL SELECT 'odoo_purchase_orders', 2, COUNT(*), MAX(synced_at) FROM odoo_purchase_orders
  UNION ALL SELECT 'odoo_invoices', 2, COUNT(*), MAX(synced_at) FROM odoo_invoices
  UNION ALL SELECT 'odoo_invoice_lines', 2, COUNT(*), MAX(synced_at) FROM odoo_invoice_lines
  UNION ALL SELECT 'odoo_payments', 2, COUNT(*), MAX(synced_at) FROM odoo_payments
  UNION ALL SELECT 'odoo_account_payments', 2, COUNT(*), MAX(synced_at) FROM odoo_account_payments
  UNION ALL SELECT 'odoo_deliveries', 2, COUNT(*), MAX(synced_at) FROM odoo_deliveries
  UNION ALL SELECT 'odoo_products', 6, COUNT(*), MAX(updated_at) FROM odoo_products
  UNION ALL SELECT 'odoo_crm_leads', 6, COUNT(*), MAX(synced_at) FROM odoo_crm_leads
  UNION ALL SELECT 'odoo_activities', 2, COUNT(*), MAX(synced_at) FROM odoo_activities
  UNION ALL SELECT 'odoo_users', 6, COUNT(*), MAX(updated_at) FROM odoo_users
  UNION ALL SELECT 'odoo_employees', 6, COUNT(*), MAX(synced_at) FROM odoo_employees
  UNION ALL SELECT 'odoo_departments', 12, COUNT(*), MAX(synced_at) FROM odoo_departments
  UNION ALL SELECT 'odoo_orderpoints', 6, COUNT(*), MAX(synced_at) FROM odoo_orderpoints
  UNION ALL SELECT 'odoo_chart_of_accounts', 12, COUNT(*), MAX(synced_at) FROM odoo_chart_of_accounts
  UNION ALL SELECT 'odoo_account_balances', 2, COUNT(*), MAX(synced_at) FROM odoo_account_balances
  UNION ALL SELECT 'odoo_bank_balances', 2, COUNT(*), MAX(updated_at) FROM odoo_bank_balances
  UNION ALL SELECT 'odoo_manufacturing', 6, COUNT(*), MAX(synced_at) FROM odoo_manufacturing
)
SELECT
  table_name,
  row_count,
  last_sync,
  expected_hours,
  EXTRACT(EPOCH FROM (NOW() - last_sync))::bigint / 60 AS minutes_ago,
  EXTRACT(EPOCH FROM (NOW() - last_sync)) / 3600 AS hours_ago,
  CASE
    WHEN last_sync IS NULL THEN 'unknown'
    WHEN EXTRACT(EPOCH FROM (NOW() - last_sync)) <= expected_hours * 3600 * 2 THEN 'fresh'
    WHEN EXTRACT(EPOCH FROM (NOW() - last_sync)) <= expected_hours * 3600 * 4 THEN 'warning'
    ELSE 'stale'
  END AS status
FROM per_table
ORDER BY
  CASE
    WHEN last_sync IS NULL THEN 0
    WHEN EXTRACT(EPOCH FROM (NOW() - last_sync)) > expected_hours * 3600 * 4 THEN 1
    WHEN EXTRACT(EPOCH FROM (NOW() - last_sync)) > expected_hours * 3600 * 2 THEN 2
    ELSE 3
  END,
  last_sync ASC NULLS FIRST;

COMMENT ON VIEW odoo_sync_freshness IS
  'Salud del sync Odoo to Supabase por tabla. Expected_hours es el SLA esperado; status=stale indica un push roto en el addon qb19. Ver commit 1e47499 y fase5 del plan director-integrity.';

-- ── 2. Ultimos errores del push (fuente: pipeline_logs via addon qb19) ─
-- El helper _run_push() en sync_push.py escribe a pipeline_logs con
-- phase='odoo_push'. Esta view expone el ultimo evento por metodo.
CREATE OR REPLACE VIEW odoo_push_last_events AS
SELECT DISTINCT ON (details->>'method')
  details->>'method' AS method,
  level,
  message,
  (details->>'rows')::int AS rows_pushed,
  (details->>'elapsed_s')::numeric AS elapsed_s,
  details->>'status' AS status,
  details->>'error' AS error,
  (details->>'full_push')::boolean AS full_push,
  created_at
FROM pipeline_logs
WHERE phase = 'odoo_push'
  AND details->>'method' IS NOT NULL
ORDER BY details->>'method', created_at DESC;

COMMENT ON VIEW odoo_push_last_events IS
  'Ultimo evento de push por metodo del addon qb19 (phase=odoo_push en pipeline_logs). Una vez parcheado el addon (commit 1e47499) esta view se llena sola.';

COMMIT;
