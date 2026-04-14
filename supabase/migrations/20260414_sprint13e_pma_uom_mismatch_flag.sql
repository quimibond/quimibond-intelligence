-- Sprint 13e: PMA with UoM-mismatch handling
--
-- After end-to-end UoM analysis (16 lines of 40,904 = 0.04% mismatch,
-- all from one product CHIFON NEGRO 011 marked as 'm' but sold in 'kg'),
-- the pragmatic decision was to NOT build full UoM conversion (cross-
-- category m<->kg requires product-specific gramaje + ancho not in Odoo)
-- but to FLAG affected products and exclude their bad lines from the
-- qty / avg-price math.
--
-- Bad lines (line_uom_id != product.uom_id) still contribute to
-- total_order_value (revenue is real $) but are excluded from clean_qty
-- so avg_order_price and gross_margin_pct don't get polluted.

DROP MATERIALIZED VIEW IF EXISTS product_margin_analysis CASCADE;

CREATE MATERIALIZED VIEW product_margin_analysis AS
WITH order_rollup AS (
  SELECT
    ol.odoo_product_id,
    ol.company_id,
    SUM(ol.qty) FILTER (
      WHERE ol.line_uom_id IS NULL OR ol.line_uom_id = p.uom_id
    ) AS clean_qty,
    SUM(COALESCE(ol.subtotal_mxn, ol.subtotal)) FILTER (
      WHERE ol.line_uom_id IS NULL OR ol.line_uom_id = p.uom_id
    ) AS clean_revenue_mxn,
    SUM(COALESCE(ol.subtotal_mxn, ol.subtotal)) AS total_order_value_mxn,
    SUM(ol.qty) AS total_qty_raw,
    COUNT(DISTINCT ol.odoo_order_id) AS order_count,
    COUNT(*) FILTER (
      WHERE ol.line_uom_id IS NOT NULL AND ol.line_uom_id != p.uom_id
    ) AS mismatch_lines_count,
    SUM(COALESCE(ol.subtotal_mxn, ol.subtotal)) FILTER (
      WHERE ol.line_uom_id IS NOT NULL AND ol.line_uom_id != p.uom_id
    ) AS mismatch_revenue_mxn
  FROM odoo_order_lines ol
  JOIN odoo_products p ON p.odoo_product_id = ol.odoo_product_id
  WHERE ol.order_type = 'sale'
    AND ol.odoo_product_id IS NOT NULL
  GROUP BY ol.odoo_product_id, ol.company_id
),
invoice_rollup AS (
  SELECT
    il.odoo_product_id,
    il.company_id,
    SUM(il.quantity) FILTER (
      WHERE il.line_uom_id IS NULL OR il.line_uom_id = p.uom_id
    ) AS clean_invoice_qty,
    SUM(COALESCE(il.price_subtotal_mxn, il.price_subtotal)) FILTER (
      WHERE il.line_uom_id IS NULL OR il.line_uom_id = p.uom_id
    ) AS clean_invoice_revenue_mxn,
    COUNT(*) FILTER (
      WHERE il.line_uom_id IS NOT NULL AND il.line_uom_id != p.uom_id
    ) AS invoice_mismatch_lines
  FROM odoo_invoice_lines il
  JOIN odoo_products p ON p.odoo_product_id = il.odoo_product_id
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
  CASE
    WHEN o.clean_qty > 0
    THEN ROUND((o.clean_revenue_mxn / o.clean_qty)::numeric, 2)
    ELSE NULL
  END AS avg_order_price,
  CASE
    WHEN i.clean_invoice_qty > 0
    THEN ROUND((i.clean_invoice_revenue_mxn / i.clean_invoice_qty)::numeric, 2)
    ELSE NULL
  END AS avg_invoice_price,
  ROUND(
    (CASE WHEN i.clean_invoice_qty > 0 THEN i.clean_invoice_revenue_mxn / i.clean_invoice_qty END
     - CASE WHEN o.clean_qty > 0 THEN o.clean_revenue_mxn / o.clean_qty END)
    / NULLIF(
        CASE WHEN o.clean_qty > 0 THEN o.clean_revenue_mxn / o.clean_qty END,
        0
      ) * 100, 1
  ) AS price_delta_pct,
  o.clean_qty AS total_qty_ordered,
  o.total_order_value_mxn AS total_order_value,
  o.order_count,
  COALESCE(o.mismatch_lines_count, 0) > 0 OR COALESCE(i.invoice_mismatch_lines, 0) > 0 AS has_uom_mismatch,
  COALESCE(o.mismatch_lines_count, 0) AS uom_mismatch_order_lines,
  COALESCE(i.invoice_mismatch_lines, 0) AS uom_mismatch_invoice_lines,
  ROUND(COALESCE(o.mismatch_revenue_mxn, 0)::numeric, 2) AS uom_mismatch_revenue_mxn,
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
         AND o.clean_qty > 0
         AND (o.clean_revenue_mxn / o.clean_qty) > 0
         AND (COALESCE(prc.real_unit_cost, p.standard_price)
              / NULLIF(o.clean_revenue_mxn / o.clean_qty, 0)) BETWEEN 0.1 AND 10
    THEN ROUND(
      ((o.clean_revenue_mxn / o.clean_qty) - COALESCE(prc.real_unit_cost, p.standard_price))
      / COALESCE(prc.real_unit_cost, p.standard_price) * 100, 1
    )
    ELSE NULL
  END AS gross_margin_pct,
  CASE
    WHEN prc.real_unit_cost IS NOT NULL AND prc.real_unit_cost > 0
         AND o.clean_qty > 0
         AND (o.clean_revenue_mxn / o.clean_qty) > 0
    THEN ROUND(
      ((o.clean_revenue_mxn / o.clean_qty) - prc.real_unit_cost) / prc.real_unit_cost * 100, 1
    )
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
CREATE INDEX idx_pma_uom_mismatch ON product_margin_analysis(has_uom_mismatch)
  WHERE has_uom_mismatch = true;

COMMENT ON MATERIALIZED VIEW product_margin_analysis IS
  'Sprint 13e: per (product x customer) margin with row-explosion fix, weighted MXN pricing, recursive BOM cost, and UoM mismatch handling. Bad lines are excluded from qty/avg_price math but still count in total_order_value.';
