-- 2026-06-01: Amplía get_bom_raw_material_cost_per_unit para incluir
-- el costo de mano de obra (MOD) de las órdenes de fabricación reales.
--
-- Contexto: En mayo 2026 se activaron los centros de trabajo (workcenters)
-- para Tejido Circular (40 máquinas CIRCULAR 1-40, $74.57/hr c/u). A partir
-- de esa fecha, cada workorder registra duration_real y genera:
--   labor_cost_mxn = SUM(wo.duration / 60 * wc.costs_hour)
-- sobre las MOs confirmadas (state='done').
--
-- El BOM recursivo anterior solo contabilizaba materia prima (MP) vía
-- avg_cost_mxn. Ahora agrega el costo real de MOD por unidad producida:
--   labor_per_unit = total_labor_mxn / qty_produced
-- para cada producto con workorders activos.
--
-- Para productos importados (' I$') el short-circuit se mantiene sin cambio
-- (no tienen producción propia).
--
-- La función es usada por get_cogs_per_product y por el P&L limpio en el
-- frontend. El cache (bom_recursive_cost_cache) se marca con source
-- 'recursive_with_labor' para que entradas anteriores sin MOD no sean
-- reutilizadas.

-- Clear cache so next refresh includes labor costs
TRUNCATE public.bom_recursive_cost_cache;

-- Updated main function: raw material + real labor cost per BOM
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
    -- Only accept entries computed with labor (v5+); old 'recursive' entries are stale
    AND source IN ('imported_short_circuit', 'recursive_with_labor', 'no_bom_no_avg')
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
-- Pre-compute labor cost per unit for all manufactured products.
-- Covers all nodes in the BOM tree that may have workorders.
labor_by_product AS (
  SELECT
    mo.odoo_product_id,
    SUM(wo.duration / 60.0 * wc.costs_hour) / NULLIF(SUM(mo.qty_produced), 0) AS labor_per_unit
  FROM public.odoo_workorders wo
  JOIN public.odoo_workcenters wc ON wc.odoo_workcenter_id = wo.odoo_workcenter_id
  JOIN public.odoo_manufacturing mo ON mo.odoo_production_id = wo.odoo_production_id
  WHERE wo.state = 'done'
    AND mo.state = 'done'
    AND NOT EXISTS (SELECT 1 FROM cached)
    AND NOT EXISTS (SELECT 1 FROM imported_short_circuit)
  GROUP BY mo.odoo_product_id
),
recursive_calc AS (
  WITH RECURSIVE explode AS (
    SELECT p_product_id::bigint AS current_product_id,
           1.0::numeric AS qty_ratio,
           0 AS depth,
           ARRAY[p_product_id]::bigint[] AS visited
    WHERE NOT EXISTS (SELECT 1 FROM cached)
      AND NOT EXISTS (SELECT 1 FROM imported_short_circuit)
    UNION ALL
    SELECT bl.odoo_product_id::bigint,
           e.qty_ratio * (bl.product_qty / NULLIF(pb.product_qty, 0)),
           e.depth + 1,
           e.visited || bl.odoo_product_id::bigint
    FROM explode e
    JOIN public.mv_primary_bom pb ON pb.odoo_product_id = e.current_product_id
    JOIN public.mrp_bom_lines bl ON bl.odoo_bom_id = pb.odoo_bom_id
    WHERE e.depth < p_max_depth AND NOT bl.odoo_product_id = ANY(e.visited)
  ),
  -- Leaf nodes: raw material cost (avg_cost × qty_ratio for products without a BOM)
  leaf_mp_cost AS (
    SELECT COALESCE(SUM(
      e.qty_ratio * COALESCE(prac.avg_cost_mxn, cp.avg_cost_mxn, 0)
    ), 0)::numeric AS raw_mp_cost
    FROM explode e
    LEFT JOIN public.canonical_products cp ON cp.odoo_product_id = e.current_product_id
    LEFT JOIN public.product_real_avg_cost prac ON prac.odoo_product_id = e.current_product_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.mv_primary_bom pb
      WHERE pb.odoo_product_id = e.current_product_id
    )
  ),
  -- All nodes with workorders: labor cost (real MOD per unit × qty_ratio)
  bom_labor_cost AS (
    SELECT COALESCE(SUM(e.qty_ratio * COALESCE(lb.labor_per_unit, 0)), 0)::numeric AS total_labor
    FROM explode e
    JOIN labor_by_product lb ON lb.odoo_product_id = e.current_product_id
  )
  SELECT (
    (SELECT raw_mp_cost FROM leaf_mp_cost) +
    (SELECT total_labor FROM bom_labor_cost)
  )::numeric AS bom_cost
)
SELECT COALESCE(
  (SELECT cost_per_unit FROM cached),
  (SELECT imported_cost FROM imported_short_circuit),
  (SELECT bom_cost FROM recursive_calc),
  0
)::numeric;
$function$;

-- Updated refresh function: uses new source tag 'recursive_with_labor'
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
        ) THEN 'recursive_with_labor'
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
         count(*) FILTER (WHERE source = 'recursive_with_labor'),
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
