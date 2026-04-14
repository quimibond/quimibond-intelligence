-- Sprint 2.5 — stockout_queue view
-- Cola priorizada de productos en riesgo de faltante (<30 días de stock).

CREATE OR REPLACE VIEW public.stockout_queue AS
WITH open_pos AS (
  SELECT ol.odoo_product_id,
         SUM(ol.qty - COALESCE(ol.qty_delivered,0)) AS qty_on_order
  FROM odoo_order_lines ol
  JOIN odoo_purchase_orders po ON po.odoo_order_id = ol.odoo_order_id
  WHERE ol.order_type = 'purchase'
    AND po.state IN ('draft','sent','to approve','purchase')
    AND ol.qty > COALESCE(ol.qty_delivered,0)
  GROUP BY ol.odoo_product_id
),
last_supplier AS (
  SELECT DISTINCT ON (ol.odoo_product_id)
    ol.odoo_product_id, c.id AS last_supplier_id, c.name AS last_supplier_name,
    ol.price_unit AS last_purchase_price, ol.order_date AS last_purchase_date
  FROM odoo_order_lines ol
  JOIN companies c ON c.id = ol.company_id
  WHERE ol.order_type = 'purchase' AND ol.price_unit > 0
  ORDER BY ol.odoo_product_id, ol.order_date DESC
)
SELECT
  iv.odoo_product_id, iv.product_ref, iv.product_name, iv.category,
  iv.stock_qty, iv.reserved_qty, iv.available_qty,
  iv.daily_run_rate, iv.qty_sold_90d, iv.days_of_stock,
  (iv.daily_run_rate * 30 * COALESCE(rsp.price_current, iv.standard_price))::numeric(20,2) AS revenue_at_risk_30d_mxn,
  (GREATEST(iv.reorder_min - iv.stock_qty, 0) * iv.avg_cost)::numeric(20,2) AS replenish_cost_mxn,
  GREATEST(COALESCE(iv.reorder_max, iv.reorder_min * 2, iv.daily_run_rate * 60) - iv.stock_qty - COALESCE(po.qty_on_order, 0), 0) AS suggested_order_qty,
  COALESCE(po.qty_on_order, 0) AS qty_on_order,
  (SELECT company_name FROM customer_product_matrix cpm
    WHERE cpm.odoo_product_id = iv.odoo_product_id
    ORDER BY cpm.revenue DESC LIMIT 1) AS top_consumer,
  ls.last_supplier_id, ls.last_supplier_name, ls.last_purchase_price, ls.last_purchase_date,
  CASE
    WHEN iv.days_of_stock IS NULL OR iv.days_of_stock <= 0 THEN 'STOCKOUT'
    WHEN iv.days_of_stock < 7  THEN 'CRITICAL'
    WHEN iv.days_of_stock < 15 THEN 'URGENT'
    WHEN iv.days_of_stock < 30 THEN 'ATTENTION'
    ELSE 'OK'
  END AS urgency,
  (LEAST(100, iv.daily_run_rate * 2)
   + GREATEST(0, 30 - COALESCE(iv.days_of_stock, 0))
   - LEAST(30, COALESCE(po.qty_on_order, 0) / NULLIF(iv.daily_run_rate,0)))::int AS priority_score
FROM inventory_velocity iv
LEFT JOIN open_pos po ON po.odoo_product_id = iv.odoo_product_id
LEFT JOIN last_supplier ls ON ls.odoo_product_id = iv.odoo_product_id
LEFT JOIN real_sale_price rsp ON rsp.odoo_product_id = iv.odoo_product_id
WHERE iv.qty_sold_90d > 0
  AND (iv.days_of_stock IS NULL OR iv.days_of_stock < 30);

COMMENT ON VIEW public.stockout_queue IS
'Cola priorizada de productos en riesgo de faltante. Urgency STOCKOUT/CRITICAL/URGENT/ATTENTION, con suggested_order_qty, last_supplier y top_consumer.';
