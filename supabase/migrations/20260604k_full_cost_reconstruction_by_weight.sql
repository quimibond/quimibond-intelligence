-- 2026-06-04k: costo por producto repartiendo gastos por PESO. conv = kg por
-- unidad (product_kg_per_unit). fab_unit = factor_fab_kg × kg/u (0 para
-- importados ' I$', que solo se inspeccionan/reempacan); op_unit = factor_op_kg
-- × kg/u. Excluye subproductos SALDO/DESPERDICIO. Mantiene MP último + promedio.
CREATE OR REPLACE FUNCTION public.get_full_cost_reconstruction(p_period text)
RETURNS TABLE(
  odoo_product_id integer, product_ref text, product_name text, uom text,
  qty_sold numeric, revenue_mxn numeric, costo_primo_unit_mxn numeric,
  factor_fab_unit_mxn numeric, factor_op_unit_mxn numeric, costo_total_unit_mxn numeric,
  costo_primo_total_mxn numeric, gastos_fab_total_mxn numeric, gastos_op_total_mxn numeric,
  costo_total_mxn numeric, pct_mp numeric, pct_fab numeric, pct_op numeric,
  margin_full_pct numeric, mp_source text,
  costo_primo_avg_unit_mxn numeric, costo_primo_avg_total_mxn numeric
)
LANGUAGE sql STABLE AS $function$
WITH factors AS (
  SELECT factor_fab_kg AS ff, factor_op_kg AS fo
  FROM public.get_cost_factors_monthly(36) WHERE mes = p_period LIMIT 1
),
d_from AS (SELECT (p_period || '-01')::date AS df),
all_lines AS (
  SELECT il.odoo_move_id, il.odoo_product_id, il.quantity, il.price_subtotal_mxn
  FROM public.odoo_invoice_lines il, d_from
  WHERE il.move_type = 'out_invoice' AND il.invoice_date >= d_from.df
    AND il.invoice_date < (d_from.df + interval '1 month') AND il.odoo_product_id IS NOT NULL
),
rev AS (SELECT odoo_product_id::int AS pid, SUM(COALESCE(price_subtotal_mxn,0))::numeric AS revenue FROM all_lines GROUP BY 1),
qty AS (
  SELECT odoo_product_id::int AS pid, SUM(quantity)::numeric AS qty_sold
  FROM (SELECT DISTINCT ON (odoo_move_id, odoo_product_id, quantity) odoo_move_id, odoo_product_id, quantity FROM all_lines) d
  GROUP BY 1
),
base AS (
  SELECT COALESCE(r.pid, q.pid) AS pid, cp.internal_ref AS product_ref, cp.display_name AS product_name,
    op.uom, COALESCE(q.qty_sold, 0) AS qty_sold, COALESCE(r.revenue, 0) AS revenue,
    public.get_bom_mp_cost_lastcost(COALESCE(r.pid, q.pid)) AS primo_unit,
    public.get_bom_raw_material_cost_per_unit(COALESCE(r.pid, q.pid)) AS primo_avg_unit,
    COALESCE(kpu.kg_per_unit, 0) AS conv,
    (cp.internal_ref ~ ' I$') AS is_import,
    (cp.is_byproduct OR cp.internal_ref ~* '^\s*(SALDO|DESPERDICIO)') AS is_byproduct,
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
  LEFT JOIN public.product_kg_per_unit kpu ON kpu.odoo_product_id = COALESCE(r.pid, q.pid)
),
calc AS (
  SELECT b.*,
    COALESCE(f.ff,0) * (CASE WHEN b.is_import THEN 0 ELSE b.conv END) AS fab_unit,
    COALESCE(f.fo,0) * b.conv AS op_unit
  FROM base b CROSS JOIN factors f
)
SELECT
  c.pid, c.product_ref, c.product_name, c.uom, c.qty_sold, ROUND(c.revenue, 2),
  ROUND(c.primo_unit, 4), ROUND(c.fab_unit, 4), ROUND(c.op_unit, 4),
  ROUND(c.primo_unit + c.fab_unit + c.op_unit, 4),
  ROUND(c.qty_sold * c.primo_unit, 2), ROUND(c.qty_sold * c.fab_unit, 2),
  ROUND(c.qty_sold * c.op_unit, 2),
  ROUND(c.qty_sold * (c.primo_unit + c.fab_unit + c.op_unit), 2),
  CASE WHEN (c.primo_unit + c.fab_unit + c.op_unit) > 0 THEN ROUND(c.primo_unit / (c.primo_unit + c.fab_unit + c.op_unit) * 100, 1) END,
  CASE WHEN (c.primo_unit + c.fab_unit + c.op_unit) > 0 THEN ROUND(c.fab_unit / (c.primo_unit + c.fab_unit + c.op_unit) * 100, 1) END,
  CASE WHEN (c.primo_unit + c.fab_unit + c.op_unit) > 0 THEN ROUND(c.op_unit / (c.primo_unit + c.fab_unit + c.op_unit) * 100, 1) END,
  CASE WHEN c.revenue > 0 THEN ROUND((c.revenue - c.qty_sold * (c.primo_unit + c.fab_unit + c.op_unit)) / c.revenue * 100, 1) END,
  c.mp_source, ROUND(c.primo_avg_unit, 4), ROUND(c.qty_sold * c.primo_avg_unit, 2)
FROM calc c
WHERE (c.qty_sold <> 0 OR c.revenue <> 0) AND NOT c.is_byproduct;
$function$;
