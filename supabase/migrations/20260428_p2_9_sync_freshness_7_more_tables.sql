-- supabase/migrations/20260428_p2_9_sync_freshness_7_more_tables.sql
--
-- P2-9 audit fix (2026-04-28): cubrir las 7 tablas Odoo faltantes en
-- odoo_sync_freshness (ahora 24/24 odoo_* + mrp_boms).
--
-- Tablas agregadas:
--   odoo_currency_rates           (catálogo, expected 12h)
--   odoo_stock_locations          (catálogo estático, expected 24h)
--   odoo_workcenters              (catálogo estático, expected 24h)
--   odoo_order_lines              (transaccional, expected 2h)
--   odoo_workorders               (manufactura baja prioridad, expected 24h)
--   odoo_stock_moves              (transaccional alta freq, 1.65M rows, expected 2h)
--   odoo_account_entries_stock    (semi-freq, 240k rows, expected 6h)
--
-- odoo_order_lines no tenía synced_at — se agrega columna + touch trigger (matches
-- pattern de migration 047 para tablas que reciben push pero no traían el campo).

BEGIN;

-- ============================================================
-- 1. Add synced_at + touch trigger a odoo_order_lines
-- ============================================================

ALTER TABLE public.odoo_order_lines
  ADD COLUMN IF NOT EXISTS synced_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.odoo_order_lines_touch_synced_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.synced_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS odoo_order_lines_synced_at_trg ON public.odoo_order_lines;
CREATE TRIGGER odoo_order_lines_synced_at_trg
BEFORE INSERT OR UPDATE ON public.odoo_order_lines
FOR EACH ROW
EXECUTE FUNCTION public.odoo_order_lines_touch_synced_at();

-- ============================================================
-- 2. Replace odoo_sync_freshness con las 7 nuevas filas
-- ============================================================

CREATE OR REPLACE VIEW public.odoo_sync_freshness AS
WITH per_table AS (
  -- ── existing 18 (preserved verbatim from 20260420 migration) ──
       SELECT 'odoo_sale_orders'::text AS table_name, 'sale_orders'::text AS push_method, 2 AS expected_hours,
              ( SELECT count(*) FROM odoo_sale_orders) AS row_count,
              ( SELECT max(synced_at) FROM odoo_sale_orders) AS row_last_sync
  UNION ALL SELECT 'odoo_purchase_orders', 'purchase_orders', 2,
              ( SELECT count(*) FROM odoo_purchase_orders),
              ( SELECT max(synced_at) FROM odoo_purchase_orders)
  UNION ALL SELECT 'odoo_invoices', 'invoices', 2,
              ( SELECT count(*) FROM odoo_invoices),
              ( SELECT max(synced_at) FROM odoo_invoices)
  UNION ALL SELECT 'odoo_invoice_lines', 'invoice_lines', 2,
              ( SELECT count(*) FROM odoo_invoice_lines),
              ( SELECT max(synced_at) FROM odoo_invoice_lines)
  UNION ALL SELECT 'odoo_account_payments', 'account_payments', 2,
              ( SELECT count(*) FROM odoo_account_payments),
              ( SELECT max(synced_at) FROM odoo_account_payments)
  UNION ALL SELECT 'odoo_deliveries', 'deliveries', 2,
              ( SELECT count(*) FROM odoo_deliveries),
              ( SELECT max(synced_at) FROM odoo_deliveries)
  UNION ALL SELECT 'odoo_products', 'products', 6,
              ( SELECT count(*) FROM odoo_products),
              ( SELECT max(updated_at) FROM odoo_products)
  UNION ALL SELECT 'odoo_crm_leads', 'crm_leads', 6,
              ( SELECT count(*) FROM odoo_crm_leads),
              ( SELECT max(synced_at) FROM odoo_crm_leads)
  UNION ALL SELECT 'odoo_activities', 'activities', 2,
              ( SELECT count(*) FROM odoo_activities),
              ( SELECT max(synced_at) FROM odoo_activities)
  UNION ALL SELECT 'odoo_users', 'users', 6,
              ( SELECT count(*) FROM odoo_users),
              ( SELECT max(updated_at) FROM odoo_users)
  UNION ALL SELECT 'odoo_employees', 'employees', 6,
              ( SELECT count(*) FROM odoo_employees),
              ( SELECT max(synced_at) FROM odoo_employees)
  UNION ALL SELECT 'odoo_departments', 'departments', 12,
              ( SELECT count(*) FROM odoo_departments),
              ( SELECT max(synced_at) FROM odoo_departments)
  UNION ALL SELECT 'odoo_orderpoints', 'orderpoints', 6,
              ( SELECT count(*) FROM odoo_orderpoints),
              ( SELECT max(synced_at) FROM odoo_orderpoints)
  UNION ALL SELECT 'odoo_chart_of_accounts', 'chart_of_accounts', 12,
              ( SELECT count(*) FROM odoo_chart_of_accounts),
              ( SELECT max(synced_at) FROM odoo_chart_of_accounts)
  UNION ALL SELECT 'odoo_account_balances', 'account_balances', 2,
              ( SELECT count(*) FROM odoo_account_balances),
              ( SELECT max(synced_at) FROM odoo_account_balances)
  UNION ALL SELECT 'odoo_bank_balances', 'bank_balances', 2,
              ( SELECT count(*) FROM odoo_bank_balances),
              ( SELECT max(updated_at) FROM odoo_bank_balances)
  UNION ALL SELECT 'odoo_manufacturing', 'manufacturing', 6,
              ( SELECT count(*) FROM odoo_manufacturing),
              ( SELECT max(synced_at) FROM odoo_manufacturing)
  UNION ALL SELECT 'mrp_boms', 'boms', 12,
              ( SELECT count(*) FROM mrp_boms),
              ( SELECT max(synced_at) FROM mrp_boms)
  -- ── nuevas 7 (P2-9) ──
  UNION ALL SELECT 'odoo_currency_rates', 'currency_rates', 12,
              ( SELECT count(*) FROM odoo_currency_rates),
              ( SELECT max(synced_at) FROM odoo_currency_rates)
  UNION ALL SELECT 'odoo_stock_locations', 'stock_locations', 24,
              ( SELECT count(*) FROM odoo_stock_locations),
              ( SELECT max(synced_at) FROM odoo_stock_locations)
  UNION ALL SELECT 'odoo_workcenters', 'workcenters', 24,
              ( SELECT count(*) FROM odoo_workcenters),
              ( SELECT max(synced_at) FROM odoo_workcenters)
  UNION ALL SELECT 'odoo_order_lines', 'order_lines', 2,
              ( SELECT count(*) FROM odoo_order_lines),
              ( SELECT max(synced_at) FROM odoo_order_lines)
  UNION ALL SELECT 'odoo_workorders', 'workorders', 24,
              ( SELECT count(*) FROM odoo_workorders),
              ( SELECT max(synced_at) FROM odoo_workorders)
  UNION ALL SELECT 'odoo_stock_moves', 'stock_moves', 2,
              ( SELECT count(*) FROM odoo_stock_moves),
              ( SELECT max(synced_at) FROM odoo_stock_moves)
  UNION ALL SELECT 'odoo_account_entries_stock', 'account_entries_stock', 6,
              ( SELECT count(*) FROM odoo_account_entries_stock),
              ( SELECT max(synced_at) FROM odoo_account_entries_stock)
), last_events AS (
  SELECT method, max(created_at) AS last_successful_run
    FROM odoo_push_last_events
   WHERE status = 'success'
   GROUP BY method
), merged AS (
  SELECT pt.table_name,
         pt.push_method,
         pt.expected_hours,
         pt.row_count,
         pt.row_last_sync,
         le.last_successful_run,
         GREATEST(pt.row_last_sync, le.last_successful_run) AS last_sync
    FROM per_table pt
    LEFT JOIN last_events le ON le.method = pt.push_method
)
SELECT table_name,
       row_count,
       last_sync,
       expected_hours,
       (EXTRACT(epoch FROM (now() - last_sync))::bigint / 60) AS minutes_ago,
       (EXTRACT(epoch FROM (now() - last_sync)) / 3600::numeric)  AS hours_ago,
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

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed)
VALUES
  ('ALTER_TABLE', 'odoo_order_lines',
   'P2-9 audit: ADD COLUMN synced_at + touch trigger (no traía columna; bloqueaba freshness tracking)',
   'supabase/migrations/20260428_p2_9_sync_freshness_7_more_tables.sql'),
  ('REPLACE_VIEW', 'odoo_sync_freshness',
   'P2-9 audit: cubrir las 7 odoo_* tablas faltantes (currency_rates, stock_locations, workcenters, order_lines, workorders, stock_moves, account_entries_stock)',
   'supabase/migrations/20260428_p2_9_sync_freshness_7_more_tables.sql');

COMMIT;
