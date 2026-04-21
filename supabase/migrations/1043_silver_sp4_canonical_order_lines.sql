-- supabase/migrations/1043_silver_sp4_canonical_order_lines.sql
--
-- Silver SP4 — Task 4: canonical_order_lines MV
-- Spec §5.11; Plan Task 4.
-- Volume: ~32,083 rows.
-- Idempotent: DROP + re-CREATE; schema_changes insert WHERE NOT EXISTS.

BEGIN;

DROP MATERIALIZED VIEW IF EXISTS canonical_order_lines CASCADE;

CREATE MATERIALIZED VIEW canonical_order_lines AS
SELECT
  ol.id                               AS canonical_id,
  ol.odoo_line_id,
  ol.odoo_order_id,
  ol.order_type,                                    -- 'sale' | 'purchase'
  ol.order_name,
  ol.order_state,
  ol.order_date,
  ol.odoo_partner_id,
  cc.id                               AS canonical_company_id,
  ol.odoo_product_id,
  cp.id                               AS canonical_product_id,
  ol.product_name,
  ol.product_ref,
  ol.qty,
  ol.qty_delivered,
  ol.qty_invoiced,
  ol.price_unit,
  ol.discount,
  ol.subtotal,
  ol.subtotal_mxn,
  ol.currency,
  ol.line_uom,
  ol.line_uom_id,
  ol.salesperson_name,
  (ol.qty - COALESCE(ol.qty_invoiced,0))::numeric AS qty_pending_invoice,
  CASE
    WHEN ol.order_type = 'sale'
     AND ol.order_state IN ('sale','done')
     AND COALESCE(ol.qty_invoiced,0) < ol.qty
    THEN true ELSE false
  END AS has_pending_invoicing,
  CASE
    WHEN ol.order_type = 'sale'
     AND ol.order_state IN ('sale','done')
     AND COALESCE(ol.qty_delivered,0) < ol.qty
    THEN true ELSE false
  END AS has_pending_delivery,
  ol.odoo_company_id,
  now() AS refreshed_at
FROM odoo_order_lines ol
LEFT JOIN canonical_companies cc ON cc.odoo_partner_id  = ol.odoo_partner_id
LEFT JOIN canonical_products  cp ON cp.odoo_product_id  = ol.odoo_product_id;

CREATE UNIQUE INDEX canonical_order_lines_pk
  ON canonical_order_lines (canonical_id);
CREATE INDEX canonical_order_lines_company_idx
  ON canonical_order_lines (canonical_company_id);
CREATE INDEX canonical_order_lines_product_idx
  ON canonical_order_lines (canonical_product_id);
CREATE INDEX canonical_order_lines_order_idx
  ON canonical_order_lines (odoo_order_id, order_type);
CREATE INDEX canonical_order_lines_type_state_idx
  ON canonical_order_lines (order_type, order_state);
CREATE INDEX canonical_order_lines_pending_inv_idx
  ON canonical_order_lines (has_pending_invoicing)
  WHERE has_pending_invoicing = true;
CREATE INDEX canonical_order_lines_pending_del_idx
  ON canonical_order_lines (has_pending_delivery)
  WHERE has_pending_delivery = true;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE_MV', 'canonical_order_lines', 'Pattern B MV over odoo_order_lines',
       'supabase/migrations/1043_silver_sp4_canonical_order_lines.sql',
       'silver-sp4-task-4', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by = 'silver-sp4-task-4');

COMMIT;
