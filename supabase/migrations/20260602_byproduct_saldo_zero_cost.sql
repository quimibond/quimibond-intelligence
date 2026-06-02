-- 2026-06-02: Subproductos (SALDO/DESPERDICIO) = costo MP $0 en el modelo
-- BOM-recursivo, para eliminar doble conteo de materia prima.
--
-- Problema detectado (audit 2026-06-02, costo MP 2025):
--   Los productos SALDO* nacen como SUBPRODUCTO de las mismas órdenes de
--   producción que el producto principal (verificado en canonical_stock_moves:
--   245 moves produccion_pt con $9.0M de valor asignado 2024-2025). La MP que
--   los compone YA está en la receta BOM del producto principal.
--
--   El modelo BOM-recursivo cobraba:
--     1. MP completa de la receta al producto principal vendido  ✓
--     2. avg_cost_mxn al SALDO vendido (vía fallback de leaf sin BOM)  ✗
--   → la misma MP contada 2 veces. Doble conteo 2025: ~$4.50M (7.6% del
--     costo MP total $59.15M). Además generaba márgenes falsos de -1,537%.
--
-- Regla adoptada:
--   - La MP se cobra UNA sola vez: en la BOM del producto principal.
--   - Subproductos (SALDO*) y desperdicios (DESPERDICIO*) → costo MP $0.
--     Su venta es recuperación pura de margen.
--   - El contable (501.01.01 AVCO) NO cambia: ahí el cost-share de Odoo a
--     subproductos es correcto porque reduce el costo del producto principal.
--     La asimetría queda visible en la fila "Δ vs P&L contable".
--
-- Cambios:
--   1. canonical_products.is_byproduct (flag manual + backfill por patrón)
--   2. get_bom_raw_material_cost_per_unit: short-circuit byproduct → 0
--      (también en hojas del árbol BOM, por si un saldo es componente)
--   3. refresh_bom_recursive_cost_cache: source 'byproduct_zero'
--   4. get_cogs_per_product: flag 'subproducto_costo_cero'
--   5. Invalidación de cache para byproducts
--
-- Después de aplicar: ejecutar refresh_cogs_monthly_cache('2024-01') para
-- recalcular la serie histórica del P&L limpio.

-- ============================================================
-- 1. Flag is_byproduct en canonical_products + backfill
-- ============================================================

ALTER TABLE public.canonical_products
  ADD COLUMN IF NOT EXISTS is_byproduct boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.canonical_products.is_byproduct IS
  'Subproducto de producción (saldos, desperdicios). Su MP ya está en la BOM '
  'del producto principal → costo MP $0 en el modelo BOM-recursivo para no '
  'duplicar. Backfill por patrón ^(SALDO|DESPERDICIO); marcar manualmente '
  'subproductos con otro naming.';

UPDATE public.canonical_products
SET is_byproduct = true
WHERE internal_ref ~* '^\s*(SALDO|DESPERDICIO)'
  AND NOT is_byproduct;

-- ============================================================
-- 2. get_bom_raw_material_cost_per_unit: byproduct → $0
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_bom_raw_material_cost_per_unit(
  p_product_id integer,
  p_max_depth integer DEFAULT 10
)
RETURNS numeric
LANGUAGE sql
STABLE
AS $function$
WITH byproduct AS (
  -- Subproductos: costo MP $0 (su MP ya está en la BOM del producto principal)
  SELECT 0::numeric AS zero_cost
  FROM public.canonical_products cp
  WHERE cp.odoo_product_id = p_product_id
    AND (cp.is_byproduct OR cp.internal_ref ~* '^\s*(SALDO|DESPERDICIO)')
),
cached AS (
  SELECT cost_per_unit
  FROM public.bom_recursive_cost_cache
  WHERE odoo_product_id = p_product_id
    AND refreshed_at > now() - interval '6 hours'
    AND NOT EXISTS (SELECT 1 FROM byproduct)
  LIMIT 1
),
imported_short_circuit AS (
  SELECT COALESCE(prac.avg_cost_mxn, cp.avg_cost_mxn) AS imported_cost
  FROM public.canonical_products cp
  LEFT JOIN public.product_real_avg_cost prac
    ON prac.odoo_product_id = cp.odoo_product_id
  WHERE cp.odoo_product_id = p_product_id
    AND cp.internal_ref ~ ' I$'
    AND NOT EXISTS (SELECT 1 FROM byproduct)
    AND NOT EXISTS (SELECT 1 FROM cached)
),
recursive_calc AS (
  WITH RECURSIVE explode AS (
    SELECT p_product_id::bigint AS current_product_id, 1.0::numeric AS qty_ratio,
           0 AS depth, ARRAY[p_product_id]::bigint[] AS visited
    WHERE NOT EXISTS (SELECT 1 FROM byproduct)
      AND NOT EXISTS (SELECT 1 FROM cached)
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
    e.qty_ratio * CASE
      -- Hojas que son subproductos también van en $0 (consistencia en el árbol)
      WHEN cp.is_byproduct OR cp.internal_ref ~* '^\s*(SALDO|DESPERDICIO)' THEN 0
      ELSE COALESCE(prac.avg_cost_mxn, cp.avg_cost_mxn, 0)
    END
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
  (SELECT zero_cost FROM byproduct),
  (SELECT cost_per_unit FROM cached),
  (SELECT imported_cost FROM imported_short_circuit),
  (SELECT bom_cost FROM recursive_calc),
  0
)::numeric;
$function$;

-- ============================================================
-- 3. refresh_bom_recursive_cost_cache: source 'byproduct_zero'
-- ============================================================

CREATE OR REPLACE FUNCTION public.refresh_bom_recursive_cost_cache()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_total integer := 0;
  v_with_bom integer := 0;
  v_imported integer := 0;
  v_byproduct integer := 0;
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
        WHEN cp.is_byproduct OR cp.internal_ref ~* '^\s*(SALDO|DESPERDICIO)' THEN 'byproduct_zero'
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
         count(*) FILTER (WHERE source = 'imported_short_circuit'),
         count(*) FILTER (WHERE source = 'byproduct_zero')
  INTO v_total, v_with_bom, v_imported, v_byproduct
  FROM public.bom_recursive_cost_cache
  WHERE refreshed_at >= v_started;

  RETURN jsonb_build_object(
    'started_at',             v_started,
    'finished_at',            clock_timestamp(),
    'total_refreshed',        v_total,
    'with_bom_recursive',     v_with_bom,
    'imported_short_circuit', v_imported,
    'byproduct_zero',         v_byproduct
  );
END;
$function$;

-- ============================================================
-- 4. get_cogs_per_product: flag 'subproducto_costo_cero'
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_cogs_per_product(p_date_from date, p_date_to date)
RETURNS TABLE(
  odoo_product_id integer, product_ref text, product_name text,
  qty_sold numeric, revenue_invoice_mxn numeric,
  cogs_recursive_unit_mxn numeric, cogs_recursive_total_mxn numeric,
  avg_cost_mxn numeric, has_bom boolean,
  margin_pct numeric, margin_mxn numeric, flags text[]
)
LANGUAGE sql
STABLE
AS $function$
WITH all_lines AS (
  SELECT il.odoo_move_id, il.odoo_product_id, il.quantity, il.price_subtotal_mxn
  FROM public.odoo_invoice_lines il
  WHERE il.move_type = 'out_invoice'
    AND il.invoice_date >= p_date_from
    AND il.invoice_date < p_date_to
    AND il.odoo_product_id IS NOT NULL
),
rev AS (
  SELECT odoo_product_id::int AS odoo_product_id,
         SUM(COALESCE(price_subtotal_mxn, 0))::numeric AS revenue_invoice_mxn
  FROM all_lines GROUP BY odoo_product_id
),
qty AS (
  SELECT odoo_product_id::int AS odoo_product_id,
         SUM(quantity)::numeric AS qty_sold
  FROM (
    SELECT DISTINCT ON (odoo_move_id, odoo_product_id, quantity)
      odoo_move_id, odoo_product_id, quantity
    FROM all_lines
  ) d
  GROUP BY odoo_product_id
),
enriched AS (
  SELECT
    COALESCE(r.odoo_product_id, q.odoo_product_id) AS odoo_product_id,
    cp.internal_ref AS product_ref,
    cp.display_name AS product_name,
    COALESCE(q.qty_sold, 0) AS qty_sold,
    COALESCE(r.revenue_invoice_mxn, 0) AS revenue_invoice_mxn,
    public.get_bom_raw_material_cost_per_unit(COALESCE(r.odoo_product_id, q.odoo_product_id)) AS cogs_recursive_unit_mxn,
    cp.avg_cost_mxn,
    EXISTS(
      SELECT 1 FROM public.mrp_boms b
      WHERE b.active AND b.odoo_product_id = COALESCE(r.odoo_product_id, q.odoo_product_id)
    ) AS has_bom,
    (cp.is_byproduct OR cp.internal_ref ~* '^\s*(SALDO|DESPERDICIO)') AS is_byproduct
  FROM rev r
  FULL OUTER JOIN qty q USING (odoo_product_id)
  LEFT JOIN public.canonical_products cp ON cp.odoo_product_id = COALESCE(r.odoo_product_id, q.odoo_product_id)
)
SELECT
  e.odoo_product_id,
  e.product_ref,
  e.product_name,
  e.qty_sold,
  e.revenue_invoice_mxn,
  e.cogs_recursive_unit_mxn,
  (e.qty_sold * e.cogs_recursive_unit_mxn)::numeric AS cogs_recursive_total_mxn,
  e.avg_cost_mxn,
  e.has_bom,
  CASE WHEN e.revenue_invoice_mxn > 0
       THEN ROUND((e.revenue_invoice_mxn - e.qty_sold * e.cogs_recursive_unit_mxn) / e.revenue_invoice_mxn * 100, 1)
       ELSE NULL END AS margin_pct,
  (e.revenue_invoice_mxn - e.qty_sold * e.cogs_recursive_unit_mxn)::numeric AS margin_mxn,
  ARRAY_REMOVE(ARRAY[
    -- Subproducto: costo $0 deliberado, no es un dato faltante
    CASE WHEN e.is_byproduct THEN 'subproducto_costo_cero' END,
    CASE WHEN NOT e.is_byproduct AND NOT e.has_bom AND (e.avg_cost_mxn IS NULL OR e.avg_cost_mxn = 0) THEN 'sin_bom_ni_costo' END,
    CASE WHEN NOT e.is_byproduct AND NOT e.has_bom AND e.avg_cost_mxn > 0 THEN 'sin_bom' END,
    CASE WHEN NOT e.is_byproduct AND e.has_bom AND COALESCE(e.cogs_recursive_unit_mxn, 0) = 0 THEN 'bom_sin_costo' END,
    CASE WHEN e.revenue_invoice_mxn > 0 AND (e.qty_sold * e.cogs_recursive_unit_mxn) > e.revenue_invoice_mxn THEN 'costo_mayor_a_venta' END,
    CASE WHEN e.revenue_invoice_mxn > 0
              AND e.qty_sold * e.cogs_recursive_unit_mxn > 0
              AND (e.revenue_invoice_mxn - e.qty_sold * e.cogs_recursive_unit_mxn) < 0
         THEN 'margen_negativo' END
  ], NULL) AS flags
FROM enriched e;
$function$;

-- ============================================================
-- 5. Invalidar cache para byproducts (entradas stale con costo > 0)
-- ============================================================

UPDATE public.bom_recursive_cost_cache c
SET cost_per_unit = 0,
    source = 'byproduct_zero',
    refreshed_at = now()
FROM public.canonical_products cp
WHERE cp.odoo_product_id = c.odoo_product_id
  AND (cp.is_byproduct OR cp.internal_ref ~* '^\s*(SALDO|DESPERDICIO)');
