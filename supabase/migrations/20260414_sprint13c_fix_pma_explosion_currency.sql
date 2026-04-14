-- Sprint 13c: fix product_margin_analysis row-explosion + multi-currency bugs
--
-- Bugs found end-to-end:
-- 1. The previous matview LEFT JOINed odoo_invoice_lines on row level,
--    causing a Cartesian fanout: 131 sale lines x 131 invoice lines = 17,161
--    rows per (product x company), inflating SUM(total_order_value) by ~131x.
--    Example: POLYCOTTON 140 reported $14.8B revenue; real value $103M MXN.
--
-- 2. avg_order_price = AVG(price_unit) mixed MXN + USD prices, producing
--    nonsense (e.g. $1.91 instead of real $36.18/m for fabric sold in both
--    currencies). Quimibond invoices in both MXN and USD.
--
-- Fix: pre-aggregate orders and invoices in separate CTEs, then join ONCE
-- per (product, company). Use SUM(subtotal_mxn) / SUM(qty) for canonical
-- MXN-per-unit price (weighted by quantity).
--
-- Note: this still does NOT handle UoM mismatches between sale lines
-- (some lines may be in kg vs m for the same product). Pending sprint
-- 13d after we sync product_uom on order/invoice lines.

DROP MATERIALIZED VIEW IF EXISTS product_margin_analysis CASCADE;

CREATE MATERIALIZED VIEW product_margin_analysis AS
WITH order_rollup AS (
  SELECT
    ol.odoo_product_id,
    ol.company_id,
    SUM(ol.qty) AS total_qty_ordered,
    SUM(COALESCE(ol.subtotal_mxn, ol.subtotal)) AS total_order_value_mxn,
    COUNT(DISTINCT ol.odoo_order_id) AS order_count,
    CASE
      WHEN SUM(ol.qty) > 0
      THEN ROUND((SUM(COALESCE(ol.subtotal_mxn, ol.subtotal)) / SUM(ol.qty))::numeric, 2)
      ELSE NULL
    END AS avg_order_price_mxn
  FROM odoo_order_lines ol
  WHERE ol.order_type = 'sale'
    AND ol.odoo_product_id IS NOT NULL
  GROUP BY ol.odoo_product_id, ol.company_id
),
invoice_rollup AS (
  SELECT
    il.odoo_product_id,
    il.company_id,
    CASE
      WHEN SUM(il.quantity) > 0
      THEN ROUND((SUM(COALESCE(il.price_subtotal_mxn, il.price_subtotal)) / SUM(il.quantity))::numeric, 2)
      ELSE NULL
    END AS avg_invoice_price_mxn,
    SUM(il.quantity) AS total_qty_invoiced
  FROM odoo_invoice_lines il
  WHERE il.move_type = 'out_invoice'
    AND il.odoo_product_id IS NOT NULL
  GROUP BY il.odoo_product_id, il.company_id
)
SELECT
  p.odoo_product_id,
  COALESCE(p.internal_ref, p.name) AS product_ref,
  p.name AS product_name,
  p.category AS product_category,
  c.id AS company_id,
  c.canonical_name AS company_name,
  o.avg_order_price_mxn AS avg_order_price,
  i.avg_invoice_price_mxn AS avg_invoice_price,
  ROUND(
    (i.avg_invoice_price_mxn - o.avg_order_price_mxn)
    / NULLIF(o.avg_order_price_mxn, 0) * 100, 1
  ) AS price_delta_pct,
  o.total_qty_ordered,
  o.total_order_value_mxn AS total_order_value,
  o.order_count,
  p.standard_price AS cached_standard_price,
  prc.real_unit_cost AS bom_real_cost,
  COALESCE(prc.real_unit_cost, p.standard_price) AS effective_cost,
  CASE
    WHEN prc.real_unit_cost IS NOT NULL THEN 'bom'
    WHEN p.standard_price > 0 THEN 'standard'
    ELSE 'none'
  END AS cost_source,
  prc.has_missing_costs AS bom_has_missing_components,
  prc.max_depth AS bom_max_depth,
  CASE
    WHEN COALESCE(prc.real_unit_cost, p.standard_price) > 0
         AND o.avg_order_price_mxn > 0
         AND (COALESCE(prc.real_unit_cost, p.standard_price) / o.avg_order_price_mxn) BETWEEN 0.1 AND 10
    THEN ROUND((o.avg_order_price_mxn - COALESCE(prc.real_unit_cost, p.standard_price))
               / COALESCE(prc.real_unit_cost, p.standard_price) * 100, 1)
    ELSE NULL
  END AS gross_margin_pct,
  CASE
    WHEN prc.real_unit_cost IS NOT NULL AND prc.real_unit_cost > 0
         AND o.avg_order_price_mxn > 0
    THEN ROUND((o.avg_order_price_mxn - prc.real_unit_cost) / prc.real_unit_cost * 100, 1)
    ELSE NULL
  END AS gross_margin_pct_bom_only
FROM order_rollup o
JOIN odoo_products p ON p.odoo_product_id = o.odoo_product_id
LEFT JOIN companies c ON c.id = o.company_id
LEFT JOIN invoice_rollup i
  ON i.odoo_product_id = o.odoo_product_id AND i.company_id = o.company_id
LEFT JOIN product_real_cost prc ON prc.odoo_product_id = o.odoo_product_id;

CREATE INDEX idx_pma_odoo_product_id ON product_margin_analysis(odoo_product_id);
CREATE INDEX idx_pma_company_id ON product_margin_analysis(company_id);
CREATE INDEX idx_pma_cost_source ON product_margin_analysis(cost_source);

COMMENT ON MATERIALIZED VIEW product_margin_analysis IS
  'Sprint 13c: per (product x customer) margin with row-explosion fix and weighted MXN pricing. CTE-based aggregation prevents Cartesian fanout. avg_order_price = SUM(subtotal_mxn) / SUM(qty) avoids mixing currencies. Still pending: UoM mismatch handling on lines.';
