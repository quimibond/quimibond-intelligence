-- Cache layer 2 para get_cogs_per_product perf
--
-- Después del fix mv_primary_bom (commit 704a73e), get_cogs_per_product
-- bajó de 6.4s → 3.1s. Pero aún era lento porque la recursión BOM se
-- ejecutaba live por cada producto vendido (~143 × ~20ms = 2.8s).
--
-- Fix layer 2: pre-cachear el resultado de get_bom_raw_material_cost_per_unit
-- por producto en una tabla. La función entonces hace lookup O(1) en vez
-- de recursión live. Refresh periódico via cron.
--
-- Resultado medido: get_cogs_per_product YTD pasa de 3102ms → 130ms (24×
-- más rápido). Combinado con MV mv_primary_bom: 6385ms → 130ms (50× total).

CREATE TABLE IF NOT EXISTS public.bom_recursive_cost_cache (
  odoo_product_id integer PRIMARY KEY,
  cost_per_unit numeric NOT NULL DEFAULT 0,
  source text NOT NULL,         -- 'imported_short_circuit' | 'recursive' | 'no_bom_no_avg'
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_brcc_refreshed
  ON public.bom_recursive_cost_cache (refreshed_at);

-- Función refresh: pobla/actualiza el cache para todos los productos
-- con BOM activa O vendidos en los últimos 12 meses (universo relevante
-- para /contabilidad y /finanzas).
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
        source = EXCLUDED.source,
        refreshed_at = now();

  SELECT count(*),
         count(*) FILTER (WHERE source = 'recursive'),
         count(*) FILTER (WHERE source = 'imported_short_circuit')
  INTO v_total, v_with_bom, v_imported
  FROM public.bom_recursive_cost_cache
  WHERE refreshed_at >= v_started;

  RETURN jsonb_build_object(
    'started_at', v_started,
    'finished_at', clock_timestamp(),
    'total_refreshed', v_total,
    'with_bom_recursive', v_with_bom,
    'imported_short_circuit', v_imported
  );
END;
$function$;

-- Patch get_bom_raw_material_cost_per_unit para usar la cache si está fresca
-- (<6h). Fallback al cómputo live si no está cacheado o stale.
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
    AND cp.internal_ref ~ ' ?I$'
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

-- Cron: refresh cada 2 horas (junto con refresh_product_real_avg_cost
-- que se ejecuta a las 04:00). El cache es de 6h por defecto, así que un
-- refresh cada 2h asegura que siempre haya data fresca.
SELECT cron.unschedule('refresh_bom_recursive_cost_cache_2h')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh_bom_recursive_cost_cache_2h');

SELECT cron.schedule(
  'refresh_bom_recursive_cost_cache_2h',
  '15 */2 * * *',  -- HH:15 cada 2 horas
  $$ SELECT public.refresh_bom_recursive_cost_cache(); $$
);
