-- BOM bug fix: priorizar BOMs con líneas > 0 (auditoría 2026-05-04 PM)
--
-- Bug: cuando un producto tiene 2+ BOMs activas y la "primera" por criterio
-- de orden está VACÍA (0 líneas), get_bom_raw_material_cost_per_unit
-- devolvía $0 ignorando otras BOMs activas con líneas válidas.
--
-- Caso real: producto 16292 "MUESTRA PILOTO TEJIDO" tenía BOM 3022
-- 'CÓDIGO GENÉRICO (DESARROLLOS)' (vacía) como primaria. Aunque tenía
-- otras 3 BOMs con líneas (3885, 4023, 4030), la función devolvía 0.
-- Esto cascadeó a IWR130Q46JAZ155 (vendido $13.5k en 2026) cuyo BOM
-- expandía a 16292.
--
-- Fix: reordenar criterio en primary_bom CTE.
--   Antes: ORDER BY code='' first, then odoo_bom_id ASC.
--   Ahora: ORDER BY (num_lines > 0) DESC first, luego code='', luego id.

CREATE OR REPLACE FUNCTION public.get_bom_raw_material_cost_per_unit(
  p_product_id integer,
  p_max_depth integer DEFAULT 10
)
RETURNS numeric
LANGUAGE sql STABLE
AS $function$
WITH RECURSIVE
  imported_short_circuit AS (
    SELECT cp.avg_cost_mxn AS imported_cost
    FROM public.canonical_products cp
    WHERE cp.odoo_product_id = p_product_id
      AND cp.internal_ref ~ ' ?I$'
  ),
  bom_with_count AS (
    SELECT
      mb.odoo_bom_id,
      mb.odoo_product_id,
      mb.product_qty,
      COALESCE(mb.code, '') AS code,
      (SELECT COUNT(*) FROM public.mrp_bom_lines bl
       WHERE bl.odoo_bom_id = mb.odoo_bom_id) AS num_lines
    FROM public.mrp_boms mb
    WHERE mb.active
  ),
  primary_bom AS (
    SELECT DISTINCT ON (odoo_product_id)
      odoo_bom_id,
      odoo_product_id,
      product_qty
    FROM bom_with_count
    ORDER BY odoo_product_id,
             CASE WHEN num_lines > 0 THEN 0 ELSE 1 END,
             CASE WHEN code = '' THEN 0 ELSE 1 END,
             odoo_bom_id
  ),
  explode AS (
    SELECT
      p_product_id::bigint AS current_product_id,
      1.0::numeric AS qty_ratio,
      0 AS depth,
      ARRAY[p_product_id]::bigint[] AS visited
    UNION ALL
    SELECT
      bl.odoo_product_id::bigint,
      e.qty_ratio * (bl.product_qty / NULLIF(pb.product_qty, 0)),
      e.depth + 1,
      e.visited || bl.odoo_product_id::bigint
    FROM explode e
    JOIN primary_bom pb ON pb.odoo_product_id = e.current_product_id
    JOIN public.mrp_bom_lines bl ON bl.odoo_bom_id = pb.odoo_bom_id
    WHERE e.depth < p_max_depth
      AND NOT bl.odoo_product_id = ANY(e.visited)
  ),
  bom_recursive AS (
    SELECT COALESCE(SUM(e.qty_ratio * COALESCE(cp.avg_cost_mxn, 0)), 0)::numeric AS bom_cost
    FROM explode e
    LEFT JOIN public.canonical_products cp
      ON cp.odoo_product_id = e.current_product_id
    WHERE NOT EXISTS (
      SELECT 1 FROM primary_bom pb
      WHERE pb.odoo_product_id = e.current_product_id
    )
  )
SELECT COALESCE(
  (SELECT imported_cost FROM imported_short_circuit),
  (SELECT bom_cost FROM bom_recursive),
  0
)::numeric;
$function$;
