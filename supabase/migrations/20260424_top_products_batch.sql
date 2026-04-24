-- F-MP-Q v2: batch RPC for top products + BOM composition.
--
-- Antes: 1 RPC para top products + N llamadas a get_bom_composition (21
-- roundtrips para top 20). Causa lag al cambiar de período.
--
-- Ahora: 1 solo RPC que agrupa con CROSS JOIN LATERAL y devuelve la
-- composición como jsonb. Requiere que get_cogs_per_product y
-- get_bom_composition ya existan.

CREATE OR REPLACE FUNCTION public.get_top_products_composition_batch(
  p_date_from date,
  p_date_to date,
  p_limit integer DEFAULT 20
)
RETURNS TABLE(
  odoo_product_id integer,
  product_ref text,
  product_name text,
  qty_sold numeric,
  revenue_invoice_mxn numeric,
  cogs_recursive_unit_mxn numeric,
  cogs_recursive_total_mxn numeric,
  avg_cost_mxn numeric,
  has_bom boolean,
  margin_pct numeric,
  margin_mxn numeric,
  flags text[],
  composition jsonb,
  leaves_without_cost integer
)
LANGUAGE sql STABLE
AS $fn$
WITH products AS (
  SELECT *
  FROM public.get_cogs_per_product(p_date_from, p_date_to)
  WHERE product_ref IS NOT NULL
    AND revenue_invoice_mxn > 0
    AND qty_sold > 0
  ORDER BY revenue_invoice_mxn DESC
  LIMIT p_limit
),
composition_raw AS (
  SELECT
    p.odoo_product_id AS src_id,
    c.leaf_product_id, c.leaf_ref, c.leaf_name,
    c.qty_per_unit, c.avg_cost_mxn AS leaf_avg_cost_mxn,
    c.cost_contribution_mxn, c.pct_of_total,
    c.depth, c.path, c.has_cost
  FROM products p
  CROSS JOIN LATERAL public.get_bom_composition(p.odoo_product_id) c
),
composition_agg AS (
  SELECT
    src_id,
    jsonb_agg(
      jsonb_build_object(
        'leafProductId', leaf_product_id,
        'leafRef', leaf_ref,
        'leafName', leaf_name,
        'qtyPerUnit', qty_per_unit,
        'avgCostMxn', leaf_avg_cost_mxn,
        'costContributionMxn', cost_contribution_mxn,
        'pctOfTotal', pct_of_total,
        'depth', depth,
        'path', path,
        'hasCost', has_cost
      )
      ORDER BY cost_contribution_mxn DESC NULLS LAST
    ) AS composition,
    COUNT(*) FILTER (WHERE NOT has_cost)::int AS leaves_without_cost
  FROM composition_raw
  GROUP BY src_id
)
SELECT
  p.odoo_product_id,
  p.product_ref,
  p.product_name,
  p.qty_sold,
  p.revenue_invoice_mxn,
  p.cogs_recursive_unit_mxn,
  p.cogs_recursive_total_mxn,
  p.avg_cost_mxn,
  p.has_bom,
  p.margin_pct,
  p.margin_mxn,
  p.flags,
  COALESCE(ca.composition, '[]'::jsonb) AS composition,
  COALESCE(ca.leaves_without_cost, 0) AS leaves_without_cost
FROM products p
LEFT JOIN composition_agg ca ON ca.src_id = p.odoo_product_id
ORDER BY p.revenue_invoice_mxn DESC;
$fn$;
