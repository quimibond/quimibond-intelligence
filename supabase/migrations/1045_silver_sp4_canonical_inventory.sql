-- supabase/migrations/1045_silver_sp4_canonical_inventory.sql
--
-- Silver SP4 — Task 6: canonical_inventory VIEW
-- Spec §5.13; Plan Task 6.
-- Pattern B live view (orderpoints-57 rows are small; materializing not worth it).

BEGIN;

DROP VIEW IF EXISTS canonical_inventory;

CREATE VIEW canonical_inventory AS
SELECT
  p.id                      AS canonical_product_id,
  p.internal_ref,
  p.display_name,
  p.odoo_product_id,
  p.stock_qty,
  p.reserved_qty,
  p.available_qty,
  p.reorder_min,
  p.reorder_max,
  op.odoo_orderpoint_id,
  op.warehouse_name,
  op.location_name,
  op.product_min_qty AS orderpoint_min,
  op.product_max_qty AS orderpoint_max,
  op.qty_to_order,
  op.qty_on_hand     AS orderpoint_qty_on_hand,
  op.qty_forecast,
  op.trigger_type,
  CASE
    WHEN op.odoo_orderpoint_id IS NOT NULL
     AND op.product_min_qty = 0
     AND op.qty_to_order > 0
    THEN true ELSE false
  END AS orderpoint_untuned,
  CASE WHEN p.available_qty <= 0 THEN true ELSE false END AS is_stockout,
  now() AS refreshed_at
FROM canonical_products p
LEFT JOIN odoo_orderpoints op ON op.odoo_product_id = p.odoo_product_id;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE_VIEW', 'canonical_inventory', 'Pattern B view: products × orderpoints',
       'supabase/migrations/1045_silver_sp4_canonical_inventory.sql',
       'silver-sp4-task-6', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by = 'silver-sp4-task-6');

COMMIT;
