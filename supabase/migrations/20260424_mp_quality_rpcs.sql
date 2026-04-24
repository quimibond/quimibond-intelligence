-- F-MP-Q: RPCs para validación de costo primo y calidad de avg_cost de MP.
--
-- Tres funciones:
--   get_mp_leaves_inventory() — inventario de hojas (MP real) con flags
--   get_bom_composition(product_id, max_depth) — explosión recursiva
--   (get_cogs_per_product y get_cogs_recursive_mp ya existen)
--
-- Hoja = producto que aparece como componente en mrp_bom_lines pero no tiene
-- BOM propia activa (es materia prima comprada, no fabricada).
--
-- CRÍTICO — FX conversion:
-- Las POs pueden estar en USD/EUR. canonical_fx_rates solo tiene desde
-- 2026-03-16. Fallback 3-nivel: rate on-or-before order_date → rate más
-- antigua disponible → default histórico (17.5 MXN/USD, 20.0 MXN/EUR).
-- Sin este fallback, COALESCE(..., 1) producía desvíos falsos de 1500%+
-- en compras pre-2026-03 en USD.

CREATE OR REPLACE FUNCTION public.get_mp_leaves_inventory()
RETURNS TABLE(
  odoo_product_id integer,
  product_ref text,
  product_name text,
  category text,
  uom text,
  avg_cost_mxn numeric,
  standard_price_mxn numeric,
  times_used_in_boms bigint,
  last_purchase_date date,
  last_purchase_price numeric,
  last_purchase_qty numeric,
  last_purchase_currency text,
  avg_cost_vs_last_pct numeric,
  days_since_purchase integer,
  flag text
)
LANGUAGE sql STABLE
AS $fn$
WITH leaves AS (
  SELECT DISTINCT bl.odoo_product_id::int AS odoo_product_id
  FROM public.mrp_bom_lines bl
  WHERE bl.odoo_product_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.mrp_boms b
      WHERE b.active AND b.odoo_product_id = bl.odoo_product_id
    )
),
usage AS (
  SELECT odoo_product_id::int AS odoo_product_id, COUNT(*)::bigint AS uses
  FROM public.mrp_bom_lines
  WHERE odoo_product_id IS NOT NULL
  GROUP BY odoo_product_id
),
last_po AS (
  SELECT DISTINCT ON (ol.odoo_product_id)
    ol.odoo_product_id::int AS odoo_product_id,
    ol.order_date,
    ol.price_unit,
    ol.qty,
    ol.currency,
    CASE
      WHEN ol.currency IS NULL OR ol.currency = 'MXN' THEN ol.price_unit
      ELSE ol.price_unit * COALESCE(
        (SELECT fx.rate FROM public.canonical_fx_rates fx
         WHERE fx.currency = ol.currency AND fx.rate_date <= ol.order_date
         ORDER BY fx.rate_date DESC LIMIT 1),
        (SELECT fx.rate FROM public.canonical_fx_rates fx
         WHERE fx.currency = ol.currency
         ORDER BY fx.rate_date ASC LIMIT 1),
        CASE WHEN ol.currency = 'USD' THEN 17.5
             WHEN ol.currency = 'EUR' THEN 20.0
             ELSE 1 END
      )
    END AS price_unit_mxn
  FROM public.odoo_order_lines ol
  WHERE ol.order_type = 'purchase'
    AND ol.order_date IS NOT NULL
    AND ol.odoo_product_id IS NOT NULL
  ORDER BY ol.odoo_product_id, ol.order_date DESC, ol.odoo_line_id DESC
)
SELECT
  l.odoo_product_id,
  cp.internal_ref AS product_ref,
  cp.display_name AS product_name,
  cp.category,
  cp.uom,
  cp.avg_cost_mxn,
  cp.standard_price_mxn,
  COALESCE(u.uses, 0) AS times_used_in_boms,
  po.order_date AS last_purchase_date,
  po.price_unit AS last_purchase_price,
  po.qty AS last_purchase_qty,
  po.currency AS last_purchase_currency,
  CASE
    WHEN po.price_unit_mxn IS NULL OR po.price_unit_mxn = 0 THEN NULL
    ELSE ROUND((cp.avg_cost_mxn - po.price_unit_mxn) / po.price_unit_mxn * 100, 1)
  END AS avg_cost_vs_last_pct,
  CASE WHEN po.order_date IS NULL THEN NULL
       ELSE (CURRENT_DATE - po.order_date)::int END AS days_since_purchase,
  CASE
    WHEN cp.avg_cost_mxn IS NULL OR cp.avg_cost_mxn = 0 THEN 'sin_avg_cost'
    WHEN po.order_date IS NULL THEN 'sin_compra_historica'
    WHEN po.price_unit_mxn > 0
         AND ABS((cp.avg_cost_mxn - po.price_unit_mxn) / po.price_unit_mxn) > 0.25
      THEN 'desvio_25pct_vs_ultima'
    WHEN (CURRENT_DATE - po.order_date) > 180 THEN 'compra_vieja_6m'
    WHEN (CURRENT_DATE - po.order_date) > 90 THEN 'compra_vieja_3m'
    ELSE 'ok'
  END AS flag
FROM leaves l
LEFT JOIN public.canonical_products cp ON cp.odoo_product_id = l.odoo_product_id
LEFT JOIN usage u ON u.odoo_product_id = l.odoo_product_id
LEFT JOIN last_po po ON po.odoo_product_id = l.odoo_product_id;
$fn$;

-- Explosión recursiva de BOM: devuelve cada hoja con su contribución al
-- costo primo total del producto final.
--
-- Usa la misma primary_bom resolution que get_bom_raw_material_cost_per_unit
-- (prefer code='' → min odoo_bom_id) para evitar multi-BOM inflation.

CREATE OR REPLACE FUNCTION public.get_bom_composition(
  p_product_id integer,
  p_max_depth integer DEFAULT 10
)
RETURNS TABLE(
  leaf_product_id integer,
  leaf_ref text,
  leaf_name text,
  qty_per_unit numeric,
  avg_cost_mxn numeric,
  cost_contribution_mxn numeric,
  pct_of_total numeric,
  depth integer,
  path text,
  has_cost boolean
)
LANGUAGE sql STABLE
AS $fn$
WITH RECURSIVE
  primary_bom AS (
    SELECT DISTINCT ON (odoo_product_id)
      odoo_bom_id, odoo_product_id, product_qty
    FROM public.mrp_boms
    WHERE active
    ORDER BY odoo_product_id,
             CASE WHEN COALESCE(code, '') = '' THEN 0 ELSE 1 END,
             odoo_bom_id
  ),
  explode AS (
    SELECT
      p_product_id::bigint AS current_product_id,
      1.0::numeric AS qty_ratio,
      0 AS depth,
      ARRAY[p_product_id]::bigint[] AS visited,
      COALESCE(
        (SELECT internal_ref FROM public.canonical_products WHERE odoo_product_id = p_product_id),
        'root'
      )::text AS path
    UNION ALL
    SELECT
      bl.odoo_product_id::bigint,
      e.qty_ratio * (bl.product_qty / NULLIF(pb.product_qty, 0)),
      e.depth + 1,
      e.visited || bl.odoo_product_id::bigint,
      (e.path || ' → ' || COALESCE(
        (SELECT internal_ref FROM public.canonical_products WHERE odoo_product_id = bl.odoo_product_id),
        bl.product_ref,
        'sin_ref'
      ))::text
    FROM explode e
    JOIN primary_bom pb ON pb.odoo_product_id = e.current_product_id
    JOIN public.mrp_bom_lines bl ON bl.odoo_bom_id = pb.odoo_bom_id
    WHERE e.depth < p_max_depth
      AND NOT bl.odoo_product_id = ANY(e.visited)
  ),
  leaves AS (
    SELECT e.*,
      cp.internal_ref AS leaf_ref,
      cp.display_name AS leaf_name,
      cp.avg_cost_mxn,
      (e.qty_ratio * COALESCE(cp.avg_cost_mxn, 0))::numeric AS contribution
    FROM explode e
    LEFT JOIN public.canonical_products cp ON cp.odoo_product_id = e.current_product_id
    WHERE NOT EXISTS (
      SELECT 1 FROM primary_bom pb WHERE pb.odoo_product_id = e.current_product_id
    )
  ),
  total AS ( SELECT SUM(contribution) AS total FROM leaves )
SELECT
  l.current_product_id::int AS leaf_product_id,
  l.leaf_ref,
  l.leaf_name,
  l.qty_ratio AS qty_per_unit,
  l.avg_cost_mxn,
  l.contribution AS cost_contribution_mxn,
  CASE WHEN t.total > 0 THEN ROUND(l.contribution / t.total * 100, 1) ELSE 0 END AS pct_of_total,
  l.depth,
  l.path,
  (l.avg_cost_mxn IS NOT NULL AND l.avg_cost_mxn > 0) AS has_cost
FROM leaves l, total t
ORDER BY l.contribution DESC NULLS LAST;
$fn$;
