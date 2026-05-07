-- Audit BOM recursivo 2026-05-07: 3 bugs encontrados, todos fixeados.
--
-- Bug 2: 8 productos con BOMs VACÍAS como primary (mv_primary_bom las
--        elegía porque eran la única activa) → costo $0. Casos:
--        IXA18048VI124130, IXJ12548AM170162, AU8617BL152, IXJ15048NG011165,
--        etc. Fix: excluir de la MV productos cuya ÚNICA BOM activa tiene
--        num_lines=0. La function fallback a `avg_cost_mxn` del producto.
--
-- Bug 3: 6 productos vendidos en abril sin canonical_products
--        (A60BL155, IXJ140Q21JNT162, WM4026NG152, WC120Q11JNT165, +2
--        servicios). Corremos matcher_product para crearlos.
--
-- Bug 4: Regex importados ' ?I$' permitía falsos positivos terminados
--        en RI/MI/II (113 matches vs 41 reales). 0 impacto numérico
--        actual pero defensivamente fixeable. Fix: regex ' I$' (espacio
--        obligatorio).

-- Bug 2 fix: regenerar mv_primary_bom excluyendo BOMs sólo-vacías
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
),
-- Bug 2 fix: para cada producto, si TODAS sus BOMs activas tienen 0
-- líneas, excluirlo de la MV (la function usará avg_cost directo en vez
-- de tratar de explotar una BOM vacía que da $0).
products_with_useful_bom AS (
  SELECT odoo_product_id
  FROM bom_with_count
  GROUP BY odoo_product_id
  HAVING MAX(num_lines) > 0
)
SELECT DISTINCT ON (odoo_product_id)
  odoo_product_id,
  odoo_bom_id,
  product_qty,
  code,
  num_lines
FROM bom_with_count
WHERE odoo_product_id IN (SELECT odoo_product_id FROM products_with_useful_bom)
  AND num_lines > 0  -- solo BOMs no-vacías
ORDER BY odoo_product_id,
         CASE WHEN code = '' THEN 0 ELSE 1 END,
         odoo_bom_id;

CREATE UNIQUE INDEX ix_mv_primary_bom_product
  ON public.mv_primary_bom (odoo_product_id);

-- Bug 4 fix: regex importados estricto (' I$' no ' ?I$')
CREATE OR REPLACE FUNCTION public.get_bom_raw_material_cost_per_unit(
  p_product_id integer,
  p_max_depth integer DEFAULT 10
)
RETURNS numeric
LANGUAGE sql
STABLE
AS $function$
WITH cached AS (
  SELECT cost_per_unit
  FROM public.bom_recursive_cost_cache
  WHERE odoo_product_id = p_product_id
    AND refreshed_at > now() - interval '6 hours'
  LIMIT 1
),
imported_short_circuit AS (
  SELECT COALESCE(prac.avg_cost_mxn, cp.avg_cost_mxn) AS imported_cost
  FROM public.canonical_products cp
  LEFT JOIN public.product_real_avg_cost prac
    ON prac.odoo_product_id = cp.odoo_product_id
  WHERE cp.odoo_product_id = p_product_id
    AND cp.internal_ref ~ ' I$'  -- BUG 4 FIX: espacio obligatorio antes de I
    AND NOT EXISTS (SELECT 1 FROM cached)
),
recursive_calc AS (
  WITH RECURSIVE explode AS (
    SELECT p_product_id::bigint AS current_product_id, 1.0::numeric AS qty_ratio,
           0 AS depth, ARRAY[p_product_id]::bigint[] AS visited
    WHERE NOT EXISTS (SELECT 1 FROM cached)
      AND NOT EXISTS (SELECT 1 FROM imported_short_circuit)
    UNION ALL
    SELECT bl.odoo_product_id::bigint,
           e.qty_ratio * (bl.product_qty / NULLIF(pb.product_qty, 0)),
           e.depth + 1, e.visited || bl.odoo_product_id::bigint
    FROM explode e
    JOIN public.mv_primary_bom pb ON pb.odoo_product_id = e.current_product_id
    JOIN public.mrp_bom_lines bl ON bl.odoo_bom_id = pb.odoo_bom_id
    WHERE e.depth < p_max_depth AND NOT bl.odoo_product_id = ANY(e.visited)
  )
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
  (SELECT cost_per_unit FROM cached),
  (SELECT imported_cost FROM imported_short_circuit),
  (SELECT bom_cost FROM recursive_calc),
  0
)::numeric;
$function$;

-- Bug 3 fix: matcher_product para los 6 productos vendidos sin canonical
-- (esto crea entries en canonical_products vinculando odoo_product_id)
SELECT public.matcher_product(internal_ref, name)
FROM public.odoo_products
WHERE odoo_product_id IN (8545, 12131, 9611, 19954, 16194, 16264);
