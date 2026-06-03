-- 2026-06-03: Reconstrucción de costo total por producto (absorption costing
-- "por fuera") con ÚLTIMO costo de compra de MP + factores de gasto por metro.
--
-- Pedido del CEO (2026-06-03):
--   1. Costo de MP por producto con el ÚLTIMO costo de compra (no avg).
--   2. Factor $/metro de fabricación = gastos de fabricación del mes ÷ metros
--      de referencia producidos (OP-ACA + OP-V10).
--   3. Costo reconstruido por producto = costo primo MP (último costo) +
--      factor fabricación. % de gastos por producto y total.
--   4. Lo mismo con gastos de operación → % del total.
--   5. Comparación: metros fabricados (referencia) vs metros vendidos.
--
-- Decisiones (confirmadas con CEO):
--   - Último costo: última compra disponible (subtotal_mxn/qty, ya en MXN);
--     fallback a avg_cost si nunca se compró. Flag de fuente por producto.
--   - Gastos de fabricación = lo más completo: MOD (501.06) + OH fábrica
--     (504.01) + depreciación fábrica (504.08-23).
--   - Gastos de operación = lo más completo: 6xx (incluye CORPO).
--   - Denominador = metros producidos en OP-ACA + OP-V10 (referencia).
--   - Factores por mes (la eficiencia varía mes a mes).
--
-- Supuesto: el factor $/metro se suma por UNIDAD de producto, asumiendo
-- 1 unidad ≈ 1 metro (la mayoría del PT se vende por metro). Para productos
-- en kg es una aproximación (visible vía uom en la salida).
--
-- Nota: OP-ACA/OP-V10 existen en Odoo desde enero 2026.

-- ============================================================
-- 1. Costo primo MP con ÚLTIMO costo de compra (recursivo)
-- ============================================================

-- Helper: último costo de compra por producto (MXN), fallback avg_cost.
-- Subproductos (SALDO/DESPERDICIO) → 0 (su MP ya está en la BOM del principal).
CREATE OR REPLACE FUNCTION public.get_leaf_last_cost_mxn(p_product_id integer)
RETURNS numeric
LANGUAGE sql
STABLE
AS $function$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.canonical_products cp
      WHERE cp.odoo_product_id = p_product_id
        AND (cp.is_byproduct OR cp.internal_ref ~* '^\s*(SALDO|DESPERDICIO)')
    ) THEN 0::numeric
    ELSE COALESCE(
      -- última compra (subtotal_mxn/qty = costo unitario neto en MXN)
      (SELECT ol.subtotal_mxn / NULLIF(ol.qty, 0)
       FROM public.odoo_order_lines ol
       WHERE ol.order_type = 'purchase' AND ol.odoo_product_id = p_product_id
         AND ol.qty > 0 AND ol.subtotal_mxn > 0
       ORDER BY ol.order_date DESC, ol.id DESC
       LIMIT 1),
      -- fallback: costo promedio real / canonical
      (SELECT COALESCE(prac.avg_cost_mxn, cp.avg_cost_mxn)
       FROM public.canonical_products cp
       LEFT JOIN public.product_real_avg_cost prac ON prac.odoo_product_id = cp.odoo_product_id
       WHERE cp.odoo_product_id = p_product_id),
      0
    )
  END;
$function$;

-- Costo primo MP recursivo usando último costo en hojas.
CREATE OR REPLACE FUNCTION public.get_bom_mp_cost_lastcost(
  p_product_id integer,
  p_max_depth integer DEFAULT 10
)
RETURNS numeric
LANGUAGE sql
STABLE
AS $function$
WITH byproduct AS (
  SELECT 1 FROM public.canonical_products cp
  WHERE cp.odoo_product_id = p_product_id
    AND (cp.is_byproduct OR cp.internal_ref ~* '^\s*(SALDO|DESPERDICIO)')
),
imported AS (
  -- Importados (' I$'): el costo real (flete/aduana) vive en la compra →
  -- usar último costo directo, no explotar la BOM.
  SELECT public.get_leaf_last_cost_mxn(p_product_id) AS cost
  FROM public.canonical_products cp
  WHERE cp.odoo_product_id = p_product_id
    AND cp.internal_ref ~ ' I$'
    AND NOT EXISTS (SELECT 1 FROM byproduct)
),
recursive_calc AS (
  WITH RECURSIVE explode AS (
    SELECT p_product_id::bigint AS cur, 1.0::numeric AS ratio,
           0 AS depth, ARRAY[p_product_id]::bigint[] AS visited
    WHERE NOT EXISTS (SELECT 1 FROM byproduct)
      AND NOT EXISTS (SELECT 1 FROM imported)
    UNION ALL
    SELECT bl.odoo_product_id::bigint,
           e.ratio * (bl.product_qty / NULLIF(pb.product_qty, 0)),
           e.depth + 1, e.visited || bl.odoo_product_id::bigint
    FROM explode e
    JOIN public.mv_primary_bom pb ON pb.odoo_product_id = e.cur
    JOIN public.mrp_bom_lines bl ON bl.odoo_bom_id = pb.odoo_bom_id
    WHERE e.depth < p_max_depth AND NOT bl.odoo_product_id = ANY(e.visited)
  )
  SELECT COALESCE(SUM(e.ratio * public.get_leaf_last_cost_mxn(e.cur::int)), 0)::numeric AS bom_cost
  FROM explode e
  WHERE NOT EXISTS (
    SELECT 1 FROM public.mv_primary_bom pb WHERE pb.odoo_product_id = e.cur
  )
)
SELECT COALESCE(
  (SELECT 0::numeric FROM byproduct),
  (SELECT cost FROM imported),
  (SELECT bom_cost FROM recursive_calc),
  0
)::numeric;
$function$;

-- ============================================================
-- 2. Factores de gasto por metro (por mes)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_cost_factors_monthly(p_months_back integer DEFAULT 12)
RETURNS TABLE(
  mes text,
  metros_referencia numeric,
  gastos_fabricacion_mxn numeric,
  gastos_operacion_mxn numeric,
  factor_fab_x_metro numeric,
  factor_op_x_metro numeric,
  factor_total_x_metro numeric
)
LANGUAGE sql
STABLE
AS $function$
WITH months AS (
  SELECT to_char(gs, 'YYYY-MM') AS mes
  FROM generate_series(
    date_trunc('month', CURRENT_DATE) - (p_months_back - 1) * interval '1 month',
    date_trunc('month', CURRENT_DATE), interval '1 month') gs
),
metros AS (
  SELECT to_char(date_finished, 'YYYY-MM') AS mes, SUM(qty_produced) AS m
  FROM public.odoo_manufacturing
  WHERE (name LIKE 'TL/OP-ACA%' OR name LIKE 'TL/OP-V10%')
    AND state = 'done' AND qty_produced > 0
  GROUP BY 1
),
gastos AS (
  SELECT period AS mes,
    SUM(balance) FILTER (WHERE account_code LIKE '501.06%'
      OR account_code LIKE '504.01%'
      OR account_code ~ '^504\.(0[89]|1[0-9]|2[0-3])') AS fab,
    SUM(balance) FILTER (WHERE account_code LIKE '6%') AS op
  FROM public.odoo_account_balances
  GROUP BY 1
)
SELECT
  mo.mes,
  COALESCE(m.m, 0)::numeric,
  COALESCE(g.fab, 0)::numeric,
  COALESCE(g.op, 0)::numeric,
  CASE WHEN COALESCE(m.m,0) > 0 THEN ROUND((g.fab / m.m)::numeric, 4) END,
  CASE WHEN COALESCE(m.m,0) > 0 THEN ROUND((g.op / m.m)::numeric, 4) END,
  CASE WHEN COALESCE(m.m,0) > 0 THEN ROUND(((COALESCE(g.fab,0) + COALESCE(g.op,0)) / m.m)::numeric, 4) END
FROM months mo
LEFT JOIN metros m ON m.mes = mo.mes
LEFT JOIN gastos g ON g.mes = mo.mes
ORDER BY mo.mes;
$function$;

-- ============================================================
-- 3. Reconstrucción de costo total por producto (un mes)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_full_cost_reconstruction(p_period text)
RETURNS TABLE(
  odoo_product_id integer,
  product_ref text,
  product_name text,
  uom text,
  qty_sold numeric,
  revenue_mxn numeric,
  costo_primo_unit_mxn numeric,
  factor_fab_unit_mxn numeric,
  factor_op_unit_mxn numeric,
  costo_total_unit_mxn numeric,
  costo_primo_total_mxn numeric,
  gastos_fab_total_mxn numeric,
  gastos_op_total_mxn numeric,
  costo_total_mxn numeric,
  pct_mp numeric,
  pct_fab numeric,
  pct_op numeric,
  margin_full_pct numeric,
  mp_source text
)
LANGUAGE sql
STABLE
AS $function$
WITH factors AS (
  SELECT factor_fab_x_metro AS ff, factor_op_x_metro AS fo
  FROM public.get_cost_factors_monthly(36)
  WHERE mes = p_period
  LIMIT 1
),
d_from AS (SELECT (p_period || '-01')::date AS df),
all_lines AS (
  SELECT il.odoo_move_id, il.odoo_product_id, il.quantity, il.price_subtotal_mxn
  FROM public.odoo_invoice_lines il, d_from
  WHERE il.move_type = 'out_invoice'
    AND il.invoice_date >= d_from.df
    AND il.invoice_date < (d_from.df + interval '1 month')
    AND il.odoo_product_id IS NOT NULL
),
rev AS (
  SELECT odoo_product_id::int AS pid, SUM(COALESCE(price_subtotal_mxn,0))::numeric AS revenue
  FROM all_lines GROUP BY 1
),
qty AS (
  SELECT odoo_product_id::int AS pid, SUM(quantity)::numeric AS qty_sold
  FROM (SELECT DISTINCT ON (odoo_move_id, odoo_product_id, quantity)
          odoo_move_id, odoo_product_id, quantity FROM all_lines) d
  GROUP BY 1
),
base AS (
  SELECT
    COALESCE(r.pid, q.pid) AS pid,
    cp.internal_ref AS product_ref,
    cp.display_name AS product_name,
    op.uom,
    COALESCE(q.qty_sold, 0) AS qty_sold,
    COALESCE(r.revenue, 0) AS revenue,
    public.get_bom_mp_cost_lastcost(COALESCE(r.pid, q.pid)) AS primo_unit,
    -- fuente del costo MP del nivel raíz (informativo)
    CASE
      WHEN cp.is_byproduct OR cp.internal_ref ~* '^\s*(SALDO|DESPERDICIO)' THEN 'subproducto_cero'
      WHEN cp.internal_ref ~ ' I$' THEN 'importado_ultima_compra'
      WHEN EXISTS (SELECT 1 FROM public.mv_primary_bom pb WHERE pb.odoo_product_id = COALESCE(r.pid,q.pid)) THEN 'bom_recursivo'
      WHEN EXISTS (SELECT 1 FROM public.odoo_order_lines ol WHERE ol.order_type='purchase' AND ol.odoo_product_id=COALESCE(r.pid,q.pid) AND ol.qty>0 AND ol.subtotal_mxn>0) THEN 'ultima_compra'
      ELSE 'avg_cost_fallback'
    END AS mp_source
  FROM rev r
  FULL OUTER JOIN qty q ON q.pid = r.pid
  LEFT JOIN public.canonical_products cp ON cp.odoo_product_id = COALESCE(r.pid, q.pid)
  LEFT JOIN public.odoo_products op ON op.odoo_product_id = COALESCE(r.pid, q.pid)
)
SELECT
  b.pid,
  b.product_ref,
  b.product_name,
  b.uom,
  b.qty_sold,
  ROUND(b.revenue, 2),
  ROUND(b.primo_unit, 4),
  ROUND(COALESCE(f.ff, 0), 4),
  ROUND(COALESCE(f.fo, 0), 4),
  ROUND(b.primo_unit + COALESCE(f.ff,0) + COALESCE(f.fo,0), 4),
  ROUND(b.qty_sold * b.primo_unit, 2),
  ROUND(b.qty_sold * COALESCE(f.ff,0), 2),
  ROUND(b.qty_sold * COALESCE(f.fo,0), 2),
  ROUND(b.qty_sold * (b.primo_unit + COALESCE(f.ff,0) + COALESCE(f.fo,0)), 2),
  CASE WHEN (b.primo_unit + COALESCE(f.ff,0) + COALESCE(f.fo,0)) > 0
       THEN ROUND(b.primo_unit / (b.primo_unit + COALESCE(f.ff,0) + COALESCE(f.fo,0)) * 100, 1) END,
  CASE WHEN (b.primo_unit + COALESCE(f.ff,0) + COALESCE(f.fo,0)) > 0
       THEN ROUND(COALESCE(f.ff,0) / (b.primo_unit + COALESCE(f.ff,0) + COALESCE(f.fo,0)) * 100, 1) END,
  CASE WHEN (b.primo_unit + COALESCE(f.ff,0) + COALESCE(f.fo,0)) > 0
       THEN ROUND(COALESCE(f.fo,0) / (b.primo_unit + COALESCE(f.ff,0) + COALESCE(f.fo,0)) * 100, 1) END,
  CASE WHEN b.revenue > 0
       THEN ROUND((b.revenue - b.qty_sold * (b.primo_unit + COALESCE(f.ff,0) + COALESCE(f.fo,0))) / b.revenue * 100, 1) END,
  b.mp_source
FROM base b CROSS JOIN factors f
WHERE b.qty_sold <> 0 OR b.revenue <> 0;
$function$;

-- ============================================================
-- 4. Metros fabricados (referencia) vs metros vendidos
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_meters_produced_vs_sold(p_months_back integer DEFAULT 12)
RETURNS TABLE(
  mes text,
  metros_op_aca numeric,
  metros_op_v10 numeric,
  metros_referencia numeric,
  metros_vendidos numeric,
  kg_vendidos numeric,
  ratio_vendido_producido numeric
)
LANGUAGE sql
STABLE
AS $function$
WITH months AS (
  SELECT to_char(gs, 'YYYY-MM') AS mes
  FROM generate_series(
    date_trunc('month', CURRENT_DATE) - (p_months_back - 1) * interval '1 month',
    date_trunc('month', CURRENT_DATE), interval '1 month') gs
),
prod AS (
  SELECT to_char(date_finished, 'YYYY-MM') AS mes,
    SUM(qty_produced) FILTER (WHERE name LIKE 'TL/OP-ACA%') AS aca,
    SUM(qty_produced) FILTER (WHERE name LIKE 'TL/OP-V10%') AS v10
  FROM public.odoo_manufacturing
  WHERE state='done' AND qty_produced>0
  GROUP BY 1
),
ventas AS (
  SELECT to_char(il.invoice_date, 'YYYY-MM') AS mes,
    SUM(il.quantity) FILTER (WHERE op.uom = 'm') AS metros,
    SUM(il.quantity) FILTER (WHERE op.uom = 'kg') AS kg
  FROM (
    SELECT DISTINCT ON (odoo_move_id, odoo_product_id, quantity)
      odoo_move_id, odoo_product_id, quantity, invoice_date
    FROM public.odoo_invoice_lines
    WHERE move_type='out_invoice' AND odoo_product_id IS NOT NULL
  ) il
  LEFT JOIN public.odoo_products op ON op.odoo_product_id = il.odoo_product_id
  GROUP BY 1
)
SELECT
  mo.mes,
  COALESCE(p.aca, 0)::numeric,
  COALESCE(p.v10, 0)::numeric,
  (COALESCE(p.aca,0) + COALESCE(p.v10,0))::numeric,
  COALESCE(v.metros, 0)::numeric,
  COALESCE(v.kg, 0)::numeric,
  CASE WHEN (COALESCE(p.aca,0) + COALESCE(p.v10,0)) > 0
       THEN ROUND(COALESCE(v.metros,0) / (COALESCE(p.aca,0) + COALESCE(p.v10,0)), 2) END
FROM months mo
LEFT JOIN prod p ON p.mes = mo.mes
LEFT JOIN ventas v ON v.mes = mo.mes
ORDER BY mo.mes;
$function$;

COMMENT ON FUNCTION public.get_full_cost_reconstruction(text) IS
  'Costo total reconstruido por producto vendido en el mes: costo primo MP '
  '(último costo de compra) + factor fabricación $/mt + factor operación $/mt, '
  'con % MP/fab/op. Consumido por /contabilidad/costo-reconstruido.';
