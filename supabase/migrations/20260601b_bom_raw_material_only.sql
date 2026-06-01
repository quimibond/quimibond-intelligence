-- 2026-06-01b: Revierte get_bom_raw_material_cost_per_unit a puro costo
-- de materia prima (sin MOD de workorders).
--
-- Razón: el labor_per_unit de workorders se duplicaría en el P&L limpio
-- porque:
--   1. get_bom_raw_material_cost_per_unit reemplaza 501.01.01 (COGS AVCO)
--   2. 501.06 (MOD real, nóminas) ya aparece como línea separada en el P&L
--
-- Si se incluye labor en el BOM-costo, el mismo costo de mano de obra
-- aparece dos veces: una en el "COGS BOM" y otra en "501.06 MOD".
-- La función debe quedarse como costo primo de MP únicamente.
--
-- Los costos de workcenters (Tejido Circular $74.57/hr) ya fluyen vía:
--   a) AVCO del producto terminado → 501.01.01 al despacho, ó
--   b) Gasto de período si no se absorbe → 501.06 u overhead
-- En ambos casos ya están en el P&L sin necesidad de agregarlos al BOM.

-- Invalidar entradas con labor (source 'recursive_with_labor')
TRUNCATE public.bom_recursive_cost_cache;

-- Revert: get_bom_raw_material_cost_per_unit = solo materia prima
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
    AND cp.internal_ref ~ ' I$'
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

-- Revert: refresh usa source='recursive' (no 'recursive_with_labor')
CREATE OR REPLACE FUNCTION public.refresh_bom_recursive_cost_cache()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_total integer := 0;
  v_with_bom integer := 0;
  v_imported integer := 0;
BEGIN
  SET LOCAL statement_timeout = '5min';

  WITH universe AS (
    SELECT DISTINCT odoo_product_id::int AS odoo_product_id
    FROM public.mv_primary_bom
    WHERE odoo_product_id IS NOT NULL
    UNION
    SELECT DISTINCT odoo_product_id::int
    FROM public.odoo_invoice_lines
    WHERE invoice_date >= CURRENT_DATE - interval '12 months'
      AND odoo_product_id IS NOT NULL
      AND move_type IN ('out_invoice','out_refund')
  ),
  computed AS (
    SELECT
      u.odoo_product_id,
      public.get_bom_raw_material_cost_per_unit(u.odoo_product_id::int) AS cost,
      CASE
        WHEN cp.internal_ref ~ ' ?I$' THEN 'imported_short_circuit'
        WHEN EXISTS (
          SELECT 1 FROM public.mv_primary_bom pb
          WHERE pb.odoo_product_id = u.odoo_product_id
        ) THEN 'recursive'
        ELSE 'no_bom_no_avg'
      END AS source
    FROM universe u
    LEFT JOIN public.canonical_products cp ON cp.odoo_product_id = u.odoo_product_id
    WHERE u.odoo_product_id IS NOT NULL
  )
  INSERT INTO public.bom_recursive_cost_cache (odoo_product_id, cost_per_unit, source, refreshed_at)
  SELECT odoo_product_id, COALESCE(cost, 0), source, now()
  FROM computed
  WHERE odoo_product_id IS NOT NULL
  ON CONFLICT (odoo_product_id) DO UPDATE
    SET cost_per_unit = EXCLUDED.cost_per_unit,
        source        = EXCLUDED.source,
        refreshed_at  = now();

  SELECT count(*),
         count(*) FILTER (WHERE source = 'recursive'),
         count(*) FILTER (WHERE source = 'imported_short_circuit')
  INTO v_total, v_with_bom, v_imported
  FROM public.bom_recursive_cost_cache
  WHERE refreshed_at >= v_started;

  RETURN jsonb_build_object(
    'started_at',             v_started,
    'finished_at',            clock_timestamp(),
    'total_refreshed',        v_total,
    'with_bom_recursive',     v_with_bom,
    'imported_short_circuit', v_imported
  );
END;
$function$;
