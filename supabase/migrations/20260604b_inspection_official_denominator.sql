-- 2026-06-04b: Inspección (TL/INSP) pasa a ser el denominador OFICIAL del
-- factor $/metro. Confirmado por el CEO: "todo se inspecciona en metros,
-- inspección es la fuente de verdad".
--
-- - get_full_cost_reconstruction ahora usa el factor basado en metros
--   inspeccionados (factor_fab_insp / factor_op_insp) en vez de acabado.
-- - get_meters_produced_vs_sold: el ratio vendido/producido se calcula vs
--   metros inspeccionados.
-- get_cost_factors_monthly se queda igual (devuelve ambos; acabado queda
-- como referencia comparativa en la UI).

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
  -- Denominador oficial: metros INSPECCIONADOS (fuente de verdad).
  SELECT factor_fab_insp AS ff, factor_op_insp AS fo
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

-- Ratio vendido/producido ahora contra metros inspeccionados.
CREATE OR REPLACE FUNCTION public.get_meters_produced_vs_sold(p_months_back integer DEFAULT 12)
RETURNS TABLE(
  mes text,
  metros_op_aca numeric,
  metros_op_v10 numeric,
  metros_referencia numeric,
  metros_inspeccion numeric,
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
insp AS (
  SELECT to_char(csm.date, 'YYYY-MM') AS mes, SUM(csm.quantity) AS m
  FROM public.canonical_stock_moves csm
  LEFT JOIN public.odoo_products op ON op.odoo_product_id = csm.odoo_product_id
  WHERE csm.reference LIKE 'TL/INSP%' AND csm.state = 'done'
    AND csm.date >= date_trunc('month', CURRENT_DATE) - p_months_back * interval '1 month'
    AND csm.quantity > 0
    AND (op.uom = 'm' OR op.uom IS NULL)
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
  COALESCE(i.m, 0)::numeric,
  COALESCE(v.metros, 0)::numeric,
  COALESCE(v.kg, 0)::numeric,
  CASE WHEN COALESCE(i.m,0) > 0
       THEN ROUND(COALESCE(v.metros,0) / i.m, 2) END
FROM months mo
LEFT JOIN prod p ON p.mes = mo.mes
LEFT JOIN insp i ON i.mes = mo.mes
LEFT JOIN ventas v ON v.mes = mo.mes
ORDER BY mo.mes;
$function$;
