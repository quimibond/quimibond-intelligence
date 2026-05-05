-- Audit 2026-05-05: BOM-MP recursive cost confidence fix
--
-- BUG: canonical_products.avg_cost_mxn está populado desde el push de
-- qb19 que mapea Odoo's product.avg_cost field, pero en Quimibond's
-- Odoo instance ese campo está aliased a standard_price (precio de
-- catálogo, NO el AVCO real al despacho). Verificado para 232/233 hojas
-- MP en BOMs activas: avg_cost == standard_price exactamente.
--
-- Impacto: la función `get_bom_raw_material_cost_per_unit` que alimenta
-- la columna "Limpio" del P&L y todo el cálculo de costo primo BOM-MP
-- recursivo usaba precios de catálogo, no AVCO real.
--
-- FIX: tabla `product_real_avg_cost` precomputada desde
-- `canonical_stock_moves` (move_category='compra' indexed). Refresh
-- diaria via cron. La función recursiva usa COALESCE(real, canonical, 0).
--
-- Magnitud del cambio: −0.5% a −1% del BOM-MP agregado (la mayoría de
-- hojas dominantes tienen avg_cost OK en Odoo). Pero corrige hojas
-- materialmente desfasadas:
--   TELA ELASTANO: canonical $13 vs real $97.72 (-87%)
--   WM4032BL152 IT: canonical $4.07 vs real $7.66 (-47%)
--   PK4032GO152 IT: canonical $3.58 vs real $1.48 (+143%)
--   ... y ~20 más con drift >25%.

-- ─────────────────────────────────────────────────────────────────────
-- (1) Tabla con AVCO real precomputado por producto
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_real_avg_cost (
  odoo_product_id bigint PRIMARY KEY,
  avg_cost_mxn numeric NOT NULL,
  sample_qty numeric NOT NULL,
  sample_value numeric NOT NULL,
  last_purchase_date date,
  n_moves int NOT NULL,
  lookback_months int NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_prac_last_purchase_date
  ON public.product_real_avg_cost(last_purchase_date DESC);

COMMENT ON TABLE public.product_real_avg_cost IS
  'AVCO real por producto derivado de canonical_stock_moves (move_category '
  'compra/devolucion_compra, state=done). Reemplaza canonical_products.avg_cost_mxn '
  'en BOM-MP recursivo donde se descubrió que avg_cost_mxn está populado desde '
  'Odoo standard_price (no el AVCO real al despacho). Audit 2026-05-05.';

-- ─────────────────────────────────────────────────────────────────────
-- (2) Función refresh con lookback principal + fallback histórico
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_product_real_avg_cost(
  p_lookback_months int DEFAULT 6
) RETURNS TABLE(rows_inserted int, products_recent int, products_fallback int)
LANGUAGE plpgsql AS $$
DECLARE
  v_recent int;
  v_fallback int;
BEGIN
  TRUNCATE public.product_real_avg_cost;

  -- Compras en los últimos N meses (window principal)
  INSERT INTO public.product_real_avg_cost
    (odoo_product_id, avg_cost_mxn, sample_qty, sample_value,
     last_purchase_date, n_moves, lookback_months, computed_at)
  SELECT
    m.odoo_product_id,
    (SUM(m.value) / NULLIF(SUM(m.quantity), 0))::numeric,
    SUM(m.quantity)::numeric,
    SUM(m.value)::numeric,
    MAX(m.date::date),
    COUNT(*)::int,
    p_lookback_months,
    now()
  FROM public.canonical_stock_moves m
  WHERE m.move_category IN ('compra', 'devolucion_compra')
    AND m.state = 'done'
    AND m.date >= (now() - (p_lookback_months || ' months')::interval)::date
    AND m.odoo_product_id IS NOT NULL
  GROUP BY m.odoo_product_id
  HAVING SUM(m.quantity) > 0 AND SUM(m.value) > 0;

  GET DIAGNOSTICS v_recent = ROW_COUNT;

  -- Fallback 24m para productos sin compra reciente
  INSERT INTO public.product_real_avg_cost
    (odoo_product_id, avg_cost_mxn, sample_qty, sample_value,
     last_purchase_date, n_moves, lookback_months, computed_at)
  SELECT
    m.odoo_product_id,
    (SUM(m.value) / NULLIF(SUM(m.quantity), 0))::numeric,
    SUM(m.quantity)::numeric,
    SUM(m.value)::numeric,
    MAX(m.date::date),
    COUNT(*)::int,
    24,
    now()
  FROM public.canonical_stock_moves m
  WHERE m.move_category IN ('compra', 'devolucion_compra')
    AND m.state = 'done'
    AND m.date >= (now() - interval '24 months')::date
    AND m.odoo_product_id IS NOT NULL
    AND m.odoo_product_id NOT IN (SELECT odoo_product_id FROM public.product_real_avg_cost)
  GROUP BY m.odoo_product_id
  HAVING SUM(m.quantity) > 0 AND SUM(m.value) > 0;

  GET DIAGNOSTICS v_fallback = ROW_COUNT;

  RETURN QUERY SELECT (v_recent + v_fallback)::int, v_recent, v_fallback;
END $$;

GRANT EXECUTE ON FUNCTION public.refresh_product_real_avg_cost(int) TO authenticator, service_role;
GRANT SELECT ON public.product_real_avg_cost TO authenticator, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- (3) Patch get_bom_raw_material_cost_per_unit: usa AVCO real con
--     fallback automático a canonical (que es legacy standard_price).
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_bom_raw_material_cost_per_unit(
  p_product_id integer,
  p_max_depth integer DEFAULT 10
)
RETURNS numeric
LANGUAGE sql STABLE
AS $function$
WITH RECURSIVE
  -- Importados (sufijo " I"): short-circuit a AVCO real (incluye landed
  -- cost vía moves IN). Fallback a canonical si no hay compra reciente.
  imported_short_circuit AS (
    SELECT COALESCE(prac.avg_cost_mxn, cp.avg_cost_mxn) AS imported_cost
    FROM public.canonical_products cp
    LEFT JOIN public.product_real_avg_cost prac
      ON prac.odoo_product_id = cp.odoo_product_id
    WHERE cp.odoo_product_id = p_product_id
      AND cp.internal_ref ~ ' ?I$'
  ),
  -- BOM primaria: prioriza con-líneas > 0 (audit 2026-05-04 PM).
  bom_with_count AS (
    SELECT mb.odoo_bom_id, mb.odoo_product_id, mb.product_qty,
           COALESCE(mb.code, '') AS code,
           (SELECT COUNT(*) FROM public.mrp_bom_lines bl
            WHERE bl.odoo_bom_id = mb.odoo_bom_id) AS num_lines
    FROM public.mrp_boms mb WHERE mb.active
  ),
  primary_bom AS (
    SELECT DISTINCT ON (odoo_product_id) odoo_bom_id, odoo_product_id, product_qty
    FROM bom_with_count
    ORDER BY odoo_product_id,
             CASE WHEN num_lines > 0 THEN 0 ELSE 1 END,
             CASE WHEN code = '' THEN 0 ELSE 1 END,
             odoo_bom_id
  ),
  explode AS (
    SELECT p_product_id::bigint AS current_product_id, 1.0::numeric AS qty_ratio,
           0 AS depth, ARRAY[p_product_id]::bigint[] AS visited
    UNION ALL
    SELECT bl.odoo_product_id::bigint,
           e.qty_ratio * (bl.product_qty / NULLIF(pb.product_qty, 0)),
           e.depth + 1, e.visited || bl.odoo_product_id::bigint
    FROM explode e
    JOIN primary_bom pb ON pb.odoo_product_id = e.current_product_id
    JOIN public.mrp_bom_lines bl ON bl.odoo_bom_id = pb.odoo_bom_id
    WHERE e.depth < p_max_depth AND NOT bl.odoo_product_id = ANY(e.visited)
  ),
  -- Hojas: COALESCE(real, canonical, 0). Real viene de stock_moves IN
  -- (compras), canonical es Odoo standard_price legacy.
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
      SELECT 1 FROM primary_bom pb WHERE pb.odoo_product_id = e.current_product_id
    )
  )
SELECT COALESCE(
  (SELECT imported_cost FROM imported_short_circuit),
  (SELECT bom_cost FROM bom_recursive),
  0
)::numeric;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- (4) Cron diario para mantener product_real_avg_cost fresco
-- ─────────────────────────────────────────────────────────────────────
-- Idempotente: si el job ya existe, no lo duplica
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh_product_real_avg_cost_daily') THEN
    PERFORM cron.schedule(
      'refresh_product_real_avg_cost_daily',
      '0 4 * * *',
      $cron$SELECT public.refresh_product_real_avg_cost(6)$cron$
    );
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- (5) Backfill inicial: ejecuta el refresh
-- ─────────────────────────────────────────────────────────────────────
SELECT public.refresh_product_real_avg_cost(6);
