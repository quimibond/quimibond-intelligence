-- Sprint 13: BOM ingestion + real manufacturing cost
--
-- Objective: replace the cached `standard_price` (often stale or zero for
-- finished goods) with a derived real_unit_cost computed by rolling down
-- each active BOM into its components and summing component costs.
--
-- New tables (populated by qb19 sync_push._push_boms):
--   * mrp_boms       — BOM headers (yield, type, code)
--   * mrp_bom_lines  — BOM components with required quantities
--
-- New matview:
--   * product_real_cost — finished good × real_unit_cost from BOM rolldown
--
-- Updated matview:
--   * product_margin_analysis — now uses real_unit_cost when available,
--     adds cost_source flag ('bom' / 'standard' / 'none').
--
-- Refresh: registered in refresh_all_matviews() (Tier 1).

-- ─── Tables ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mrp_boms (
  id bigserial PRIMARY KEY,
  odoo_bom_id bigint UNIQUE NOT NULL,
  odoo_product_tmpl_id bigint,
  odoo_product_id bigint,
  product_name text,
  product_ref text,
  product_qty numeric NOT NULL DEFAULT 1,
  product_uom text,
  code text,
  bom_type text,
  active boolean DEFAULT true,
  odoo_company_id bigint,
  synced_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mrp_boms_odoo_product_id ON mrp_boms(odoo_product_id);
CREATE INDEX IF NOT EXISTS idx_mrp_boms_odoo_product_tmpl_id ON mrp_boms(odoo_product_tmpl_id);
CREATE INDEX IF NOT EXISTS idx_mrp_boms_active ON mrp_boms(active) WHERE active = true;

CREATE TABLE IF NOT EXISTS mrp_bom_lines (
  id bigserial PRIMARY KEY,
  odoo_bom_line_id bigint UNIQUE NOT NULL,
  odoo_bom_id bigint NOT NULL,
  odoo_product_id bigint,
  product_name text,
  product_ref text,
  product_qty numeric NOT NULL DEFAULT 0,
  product_uom text,
  synced_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mrp_bom_lines_odoo_bom_id ON mrp_bom_lines(odoo_bom_id);
CREATE INDEX IF NOT EXISTS idx_mrp_bom_lines_odoo_product_id ON mrp_bom_lines(odoo_product_id);

COMMENT ON TABLE mrp_boms IS 'Bill of Materials headers (mrp.bom) — manufacturing recipes for finished goods';
COMMENT ON TABLE mrp_bom_lines IS 'BOM components (mrp.bom.line) — raw materials with required quantities';
COMMENT ON COLUMN mrp_boms.product_qty IS 'BOM yield: how many units of finished good this recipe produces';
COMMENT ON COLUMN mrp_bom_lines.product_qty IS 'Component quantity required for the BOM yield (NOT per-unit)';

-- ─── product_real_cost matview ────────────────────────────────────────

DROP MATERIALIZED VIEW IF EXISTS product_real_cost CASCADE;

CREATE MATERIALIZED VIEW product_real_cost AS
WITH bom_components AS (
  SELECT
    b.odoo_bom_id,
    b.odoo_product_id AS finished_product_id,
    b.product_name AS finished_product_name,
    b.product_ref AS finished_product_ref,
    b.product_qty AS bom_yield,
    b.bom_type,
    bl.odoo_product_id AS component_product_id,
    bl.product_name AS component_name,
    bl.product_ref AS component_ref,
    bl.product_qty AS component_qty,
    p.standard_price AS component_unit_cost,
    (bl.product_qty * COALESCE(p.standard_price, 0)) AS line_cost
  FROM mrp_boms b
  JOIN mrp_bom_lines bl ON bl.odoo_bom_id = b.odoo_bom_id
  LEFT JOIN odoo_products p ON p.odoo_product_id = bl.odoo_product_id
  WHERE b.active = true
    AND b.odoo_product_id IS NOT NULL
)
SELECT
  finished_product_id AS odoo_product_id,
  MAX(finished_product_name) AS product_name,
  MAX(finished_product_ref) AS product_ref,
  MAX(odoo_bom_id) AS odoo_bom_id,
  MAX(bom_yield) AS bom_yield,
  MAX(bom_type) AS bom_type,
  COUNT(*) AS component_count,
  SUM(line_cost) AS material_cost_total,
  ROUND((SUM(line_cost) / NULLIF(MAX(bom_yield), 0))::numeric, 4) AS real_unit_cost,
  MAX(fp.standard_price) AS cached_standard_price,
  ROUND(
    CASE
      WHEN MAX(fp.standard_price) IS NULL OR MAX(fp.standard_price) = 0 THEN NULL
      ELSE ((SUM(line_cost) / NULLIF(MAX(bom_yield), 0)) - MAX(fp.standard_price))
           / MAX(fp.standard_price) * 100
    END::numeric, 1
  ) AS delta_vs_cached_pct,
  BOOL_OR(component_unit_cost IS NULL OR component_unit_cost = 0) AS has_missing_costs,
  COUNT(*) FILTER (WHERE component_unit_cost IS NULL OR component_unit_cost = 0) AS missing_cost_components,
  NOW() AS computed_at
FROM bom_components bc
LEFT JOIN odoo_products fp ON fp.odoo_product_id = bc.finished_product_id
GROUP BY finished_product_id;

CREATE UNIQUE INDEX idx_product_real_cost_pk ON product_real_cost(odoo_product_id);
CREATE INDEX idx_product_real_cost_delta ON product_real_cost(delta_vs_cached_pct);
CREATE INDEX idx_product_real_cost_missing ON product_real_cost(has_missing_costs) WHERE has_missing_costs = true;

COMMENT ON MATERIALIZED VIEW product_real_cost IS
  'Sprint 13: real unit cost of manufactured products derived from active BOMs. '
  'Compares with cached standard_price to detect over/undercosted SKUs.';

-- ─── product_margin_analysis: now BOM-aware ───────────────────────────

DROP MATERIALIZED VIEW IF EXISTS product_margin_analysis CASCADE;

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
         prc.real_unit_cost, prc.has_missing_costs;

CREATE INDEX idx_pma_odoo_product_id ON product_margin_analysis(odoo_product_id);
CREATE INDEX idx_pma_company_id ON product_margin_analysis(company_id);
CREATE INDEX idx_pma_cost_source ON product_margin_analysis(cost_source);

COMMENT ON MATERIALIZED VIEW product_margin_analysis IS
  'Sprint 13: per (product × customer) margin analysis. Now uses BOM-derived '
  'real_unit_cost when available, falling back to cached standard_price. '
  'cost_source column reveals provenance.';

-- ─── refresh_all_matviews(): register product_real_cost ───────────────

CREATE OR REPLACE FUNCTION public.refresh_all_matviews()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- TIER 1: No dependencies (base matviews)
  REFRESH MATERIALIZED VIEW company_profile;
  REFRESH MATERIALIZED VIEW monthly_revenue_by_company;
  REFRESH MATERIALIZED VIEW portfolio_concentration;
  REFRESH MATERIALIZED VIEW ar_aging_detail;
  REFRESH MATERIALIZED VIEW accounting_anomalies;
  REFRESH MATERIALIZED VIEW customer_cohorts;
  REFRESH MATERIALIZED VIEW customer_margin_analysis;
  REFRESH MATERIALIZED VIEW customer_product_matrix;
  REFRESH MATERIALIZED VIEW supplier_product_matrix;
  REFRESH MATERIALIZED VIEW dead_stock_analysis;
  REFRESH MATERIALIZED VIEW inventory_velocity;
  REFRESH MATERIALIZED VIEW ops_delivery_health_weekly;
  REFRESH MATERIALIZED VIEW product_margin_analysis;
  REFRESH MATERIALIZED VIEW product_seasonality;
  REFRESH MATERIALIZED VIEW purchase_price_intelligence;
  REFRESH MATERIALIZED VIEW supplier_concentration_herfindahl;
  REFRESH MATERIALIZED VIEW company_email_intelligence;
  REFRESH MATERIALIZED VIEW company_handlers;
  REFRESH MATERIALIZED VIEW company_insight_history;
  REFRESH MATERIALIZED VIEW cross_director_signals;
  REFRESH MATERIALIZED VIEW cashflow_projection;

  -- Sprint 2 — nuevos matviews
  REFRESH MATERIALIZED VIEW real_sale_price;
  REFRESH MATERIALIZED VIEW supplier_price_index;

  -- Sprint 13 — BOM rolldown
  REFRESH MATERIALIZED VIEW product_real_cost;

  -- TIER 2: Depends on company_profile
  REFRESH MATERIALIZED VIEW company_narrative;
  REFRESH MATERIALIZED VIEW customer_ltv_health;
  REFRESH MATERIALIZED VIEW payment_predictions;
  REFRESH MATERIALIZED VIEW client_reorder_predictions;

  REFRESH MATERIALIZED VIEW rfm_segments;

  RAISE NOTICE 'All 29 materialized views refreshed successfully';
END;
$function$;
