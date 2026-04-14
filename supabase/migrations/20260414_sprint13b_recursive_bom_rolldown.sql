-- Sprint 13b: recursive BOM rolldown
--
-- Replaces the 1-level product_real_cost matview with a true recursive
-- explosion that walks each BOM down to its actual raw materials (leaves
-- with no active BOM) and accumulates qty x leaf standard_price.
--
-- Key design decisions:
--   * Multi-BOM products: pick the BOM with the highest odoo_bom_id
--     (assumed to be the most recently created / current revision).
--     Flag has_multiple_boms so the UI can warn.
--   * Cycles: tracked via array path; a child already in the path is
--     skipped (not infinite-looped).
--   * Depth cap: 15 (max real depth observed = 9).
--   * Leaf = product without an active BOM (true raw material).
--     Its standard_price contributes to the rolled-up cost.
--   * Effective qty per root unit: bl.product_qty / bom.product_qty
--     (handles BOMs that yield more than 1 unit).
--   * has_missing_costs = at least one leaf has NULL or 0 standard_price.
--
-- Also recreates product_margin_analysis (dropped via CASCADE) with the
-- new bom_max_depth column.

DROP MATERIALIZED VIEW IF EXISTS product_real_cost CASCADE;

CREATE MATERIALIZED VIEW product_real_cost AS
WITH RECURSIVE
canonical_boms AS (
  SELECT DISTINCT ON (b.odoo_product_id)
    b.odoo_product_id,
    b.odoo_bom_id,
    b.product_qty AS bom_yield,
    b.bom_type,
    b.product_name,
    b.product_ref
  FROM mrp_boms b
  WHERE b.active = true
    AND b.odoo_product_id IS NOT NULL
  ORDER BY b.odoo_product_id, b.odoo_bom_id DESC
),
bom_counts AS (
  SELECT odoo_product_id, COUNT(*) AS bom_count
  FROM mrp_boms
  WHERE active AND odoo_product_id IS NOT NULL
  GROUP BY odoo_product_id
),
explosion AS (
  -- Anchor: direct components of each canonical BOM
  SELECT
    cb.odoo_product_id AS root_product_id,
    cb.odoo_bom_id AS root_bom_id,
    cb.bom_yield AS root_yield,
    bl.odoo_product_id AS leaf_product_id,
    (bl.product_qty / NULLIF(cb.bom_yield, 0)) AS qty_per_root_unit,
    1 AS depth,
    ARRAY[cb.odoo_product_id] AS path
  FROM canonical_boms cb
  JOIN mrp_bom_lines bl ON bl.odoo_bom_id = cb.odoo_bom_id
  WHERE bl.odoo_product_id IS NOT NULL

  UNION ALL

  -- Recursive: explode any leaf that has its own canonical BOM
  SELECT
    e.root_product_id,
    e.root_bom_id,
    e.root_yield,
    bl2.odoo_product_id AS leaf_product_id,
    e.qty_per_root_unit
      * (bl2.product_qty / NULLIF(cb2.bom_yield, 0)) AS qty_per_root_unit,
    e.depth + 1,
    e.path || e.leaf_product_id
  FROM explosion e
  JOIN canonical_boms cb2 ON cb2.odoo_product_id = e.leaf_product_id
  JOIN mrp_bom_lines bl2 ON bl2.odoo_bom_id = cb2.odoo_bom_id
  WHERE bl2.odoo_product_id IS NOT NULL
    AND NOT (bl2.odoo_product_id = ANY(e.path))  -- cycle guard
    AND e.depth < 15
),
-- Keep only rows where leaf is a TRUE raw material (no canonical BOM)
leaves_only AS (
  SELECT
    e.root_product_id,
    e.root_bom_id,
    e.root_yield,
    e.leaf_product_id,
    e.qty_per_root_unit,
    e.depth,
    p.standard_price AS leaf_unit_cost,
    (e.qty_per_root_unit * COALESCE(p.standard_price, 0)) AS line_cost
  FROM explosion e
  LEFT JOIN odoo_products p ON p.odoo_product_id = e.leaf_product_id
  WHERE NOT EXISTS (
    SELECT 1 FROM canonical_boms cb3 WHERE cb3.odoo_product_id = e.leaf_product_id
  )
),
roll_up AS (
  SELECT
    root_product_id,
    MAX(root_bom_id) AS odoo_bom_id,
    MAX(root_yield) AS bom_yield,
    COUNT(*) AS raw_components_count,
    COUNT(DISTINCT leaf_product_id) AS distinct_raw_components,
    MAX(depth) AS max_depth,
    SUM(line_cost) AS material_cost_total,
    BOOL_OR(leaf_unit_cost IS NULL OR leaf_unit_cost = 0) AS has_missing_costs,
    COUNT(*) FILTER (WHERE leaf_unit_cost IS NULL OR leaf_unit_cost = 0)
      AS missing_cost_components
  FROM leaves_only
  GROUP BY root_product_id
)
SELECT
  ru.root_product_id AS odoo_product_id,
  rp.name AS product_name,
  rp.internal_ref AS product_ref,
  ru.odoo_bom_id,
  ru.bom_yield,
  cb_meta.bom_type,
  ru.raw_components_count,
  ru.distinct_raw_components,
  ru.max_depth,
  ROUND(ru.material_cost_total::numeric, 4) AS material_cost_total,
  ROUND(ru.material_cost_total::numeric, 4) AS real_unit_cost,
  rp.standard_price AS cached_standard_price,
  ROUND(
    CASE
      WHEN rp.standard_price IS NULL OR rp.standard_price = 0 THEN NULL
      ELSE (ru.material_cost_total - rp.standard_price) / rp.standard_price * 100
    END::numeric, 1
  ) AS delta_vs_cached_pct,
  ru.has_missing_costs,
  ru.missing_cost_components,
  COALESCE(bc.bom_count, 1) AS active_boms_for_product,
  COALESCE(bc.bom_count, 1) > 1 AS has_multiple_boms,
  NOW() AS computed_at
FROM roll_up ru
LEFT JOIN odoo_products rp ON rp.odoo_product_id = ru.root_product_id
LEFT JOIN canonical_boms cb_meta ON cb_meta.odoo_product_id = ru.root_product_id
LEFT JOIN bom_counts bc ON bc.odoo_product_id = ru.root_product_id;

CREATE UNIQUE INDEX idx_product_real_cost_pk ON product_real_cost(odoo_product_id);
CREATE INDEX idx_product_real_cost_delta ON product_real_cost(delta_vs_cached_pct);
CREATE INDEX idx_product_real_cost_missing ON product_real_cost(has_missing_costs)
  WHERE has_missing_costs = true;
CREATE INDEX idx_product_real_cost_multi ON product_real_cost(has_multiple_boms)
  WHERE has_multiple_boms = true;
CREATE INDEX idx_product_real_cost_depth ON product_real_cost(max_depth);

COMMENT ON MATERIALIZED VIEW product_real_cost IS
  'Sprint 13b: recursive BOM rolldown. For each finished product with an active BOM, walks the entire sub-BOM tree down to true raw materials and sums (effective_qty * standard_price). Multi-BOM products use the most recent BOM. Cycles cut via path tracking. Depth capped at 15.';

-- Recreate product_margin_analysis (dropped via CASCADE on product_real_cost)
CREATE MATERIALIZED VIEW product_margin_analysis AS
SELECT
  p.odoo_product_id,
  COALESCE(p.internal_ref, p.name) AS product_ref,
  p.name AS product_name,
  p.category AS product_category,
  c.id AS company_id,
  c.canonical_name AS company_name,
  ROUND(AVG(ol.price_unit), 2) AS avg_order_price,
  ROUND(AVG(il.price_unit), 2) AS avg_invoice_price,
  ROUND((AVG(il.price_unit) - AVG(ol.price_unit)) / NULLIF(AVG(ol.price_unit), 0)
        * 100, 1) AS price_delta_pct,
  SUM(ol.qty) AS total_qty_ordered,
  SUM(COALESCE(ol.subtotal_mxn, ol.subtotal)) AS total_order_value,
  COUNT(DISTINCT ol.odoo_order_id) AS order_count,
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
         AND AVG(ol.price_unit) > 0
         AND (COALESCE(prc.real_unit_cost, p.standard_price) / AVG(ol.price_unit)) BETWEEN 0.1 AND 10
    THEN ROUND((AVG(ol.price_unit) - COALESCE(prc.real_unit_cost, p.standard_price))
               / COALESCE(prc.real_unit_cost, p.standard_price) * 100, 1)
    ELSE NULL
  END AS gross_margin_pct,
  CASE
    WHEN prc.real_unit_cost IS NOT NULL AND prc.real_unit_cost > 0
         AND AVG(ol.price_unit) > 0
    THEN ROUND((AVG(ol.price_unit) - prc.real_unit_cost) / prc.real_unit_cost * 100, 1)
    ELSE NULL
  END AS gross_margin_pct_bom_only
FROM odoo_order_lines ol
JOIN odoo_products p ON p.odoo_product_id = ol.odoo_product_id
LEFT JOIN companies c ON c.id = ol.company_id
LEFT JOIN odoo_invoice_lines il
       ON il.odoo_product_id = ol.odoo_product_id
      AND il.company_id = ol.company_id
      AND il.move_type = 'out_invoice'
LEFT JOIN product_real_cost prc ON prc.odoo_product_id = p.odoo_product_id
WHERE ol.order_type = 'sale'
  AND ol.odoo_product_id IS NOT NULL
GROUP BY p.odoo_product_id, p.name, p.internal_ref, p.category,
         c.id, c.canonical_name, p.standard_price,
         prc.real_unit_cost, prc.has_missing_costs, prc.max_depth;

CREATE INDEX idx_pma_odoo_product_id ON product_margin_analysis(odoo_product_id);
CREATE INDEX idx_pma_company_id ON product_margin_analysis(company_id);
CREATE INDEX idx_pma_cost_source ON product_margin_analysis(cost_source);

COMMENT ON MATERIALIZED VIEW product_margin_analysis IS
  'Sprint 13b: per (product x customer) margin analysis with recursive BOM cost.';
