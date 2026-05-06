-- Perf fix: get_bom_raw_material_cost_per_unit O(N²) → O(N)
--
-- Problema: la función se llama N veces (1 por producto vendido) y cada
-- llamada re-escanea mrp_boms (1988 rows con seq scan ~1.2s observado) +
-- mrp_bom_lines (4801 rows) para reconstruir el primary_bom (DISTINCT ON
-- por producto). Total YTD para get_cogs_per_product: 143 productos × ~45ms
-- por producto = 6.4s, supera intermitentemente el 8s de PostgREST timeout
-- y rompe /contabilidad cuando el cache cold.
--
-- Fix: pre-computar primary_bom en una MV con UNIQUE INDEX. La función
-- entonces hace lookup O(1) en vez de re-calcular cada vez.
--
-- Refresh: ON-DEMAND vía cron (existing refresh-all-matviews cada 2h ya
-- toma TODAS las MVs públicas).

DROP MATERIALIZED VIEW IF EXISTS public.mv_primary_bom CASCADE;

CREATE MATERIALIZED VIEW public.mv_primary_bom AS
WITH bom_with_count AS (
  SELECT mb.odoo_bom_id, mb.odoo_product_id, mb.product_qty,
         COALESCE(mb.code, '') AS code,
         COALESCE(blc.n, 0) AS num_lines
  FROM public.mrp_boms mb
  LEFT JOIN (
    SELECT odoo_bom_id, COUNT(*) AS n
    FROM public.mrp_bom_lines
    GROUP BY odoo_bom_id
  ) blc ON blc.odoo_bom_id = mb.odoo_bom_id
  WHERE mb.active
)
SELECT DISTINCT ON (odoo_product_id)
  odoo_product_id,
  odoo_bom_id,
  product_qty,
  code,
  num_lines
FROM bom_with_count
ORDER BY odoo_product_id,
         CASE WHEN num_lines > 0 THEN 0 ELSE 1 END,
         CASE WHEN code = '' THEN 0 ELSE 1 END,
         odoo_bom_id;

CREATE UNIQUE INDEX ix_mv_primary_bom_product
  ON public.mv_primary_bom (odoo_product_id);

-- Función patcheada para usar la MV en vez de re-calcular primary_bom
CREATE OR REPLACE FUNCTION public.get_bom_raw_material_cost_per_unit(
  p_product_id integer,
  p_max_depth integer DEFAULT 10
)
RETURNS numeric
LANGUAGE sql
STABLE
AS $function$
WITH RECURSIVE
  imported_short_circuit AS (
    SELECT COALESCE(prac.avg_cost_mxn, cp.avg_cost_mxn) AS imported_cost
    FROM public.canonical_products cp
    LEFT JOIN public.product_real_avg_cost prac
      ON prac.odoo_product_id = cp.odoo_product_id
    WHERE cp.odoo_product_id = p_product_id
      AND cp.internal_ref ~ ' ?I$'
  ),
  explode AS (
    SELECT p_product_id::bigint AS current_product_id, 1.0::numeric AS qty_ratio,
           0 AS depth, ARRAY[p_product_id]::bigint[] AS visited
    UNION ALL
    SELECT bl.odoo_product_id::bigint,
           e.qty_ratio * (bl.product_qty / NULLIF(pb.product_qty, 0)),
           e.depth + 1, e.visited || bl.odoo_product_id::bigint
    FROM explode e
    JOIN public.mv_primary_bom pb ON pb.odoo_product_id = e.current_product_id
    JOIN public.mrp_bom_lines bl ON bl.odoo_bom_id = pb.odoo_bom_id
    WHERE e.depth < p_max_depth AND NOT bl.odoo_product_id = ANY(e.visited)
  ),
  bom_recursive AS (
    SELECT COALESCE(SUM(
      e.qty_ratio * COALESCE(prac.avg_cost_mxn, cp.avg_cost_mxn, 0)
    ), 0)::numeric AS bom_cost
    FROM explode e
    LEFT JOIN public.canonical_products cp
      ON cp.odoo_product_id = e.current_product_id
    LEFT JOIN public.product_real_avg_cost prac
      ON prac.odoo_product_id = e.current_product_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.mv_primary_bom pb
      WHERE pb.odoo_product_id = e.current_product_id
    )
  )
SELECT COALESCE(
  (SELECT imported_cost FROM imported_short_circuit),
  (SELECT bom_cost FROM bom_recursive),
  0
)::numeric;
$function$;
