-- 2026-06-04j: factores por PESO. fab ÷ kg inspeccionados (excluye importados,
-- que no se fabrican), op ÷ kg vendidos. kg por unidad: product_kg_per_unit.
DROP FUNCTION IF EXISTS public.get_cost_factors_monthly(integer);
CREATE FUNCTION public.get_cost_factors_monthly(p_months_back integer DEFAULT 12)
RETURNS TABLE(
  mes text, metros_referencia numeric, metros_inspeccion numeric, metros_vendidos_equiv numeric,
  gastos_fabricacion_mxn numeric, gastos_operacion_mxn numeric,
  factor_fab_x_metro numeric, factor_op_x_metro numeric, factor_total_x_metro numeric,
  factor_fab_insp numeric, factor_op_insp numeric, factor_total_insp numeric, factor_op_vendido numeric,
  kg_inspeccion numeric, kg_vendidos numeric,
  factor_fab_kg numeric, factor_op_kg numeric, factor_total_kg numeric
)
LANGUAGE sql STABLE AS $function$
WITH months AS (
  SELECT to_char(gs, 'YYYY-MM') AS mes
  FROM generate_series(date_trunc('month', CURRENT_DATE) - (p_months_back - 1) * interval '1 month',
    date_trunc('month', CURRENT_DATE), interval '1 month') gs
),
metros AS (
  SELECT to_char(date_finished, 'YYYY-MM') AS mes, SUM(qty_produced) AS m
  FROM public.odoo_manufacturing
  WHERE (name LIKE 'TL/OP-ACA%' OR name LIKE 'TL/OP-V10%') AND state='done' AND qty_produced>0 GROUP BY 1
),
insp AS (
  SELECT to_char(csm.date,'YYYY-MM') AS mes, SUM(csm.quantity) AS m,
         SUM(csm.quantity * kpu.kg_per_unit) FILTER (WHERE cp.internal_ref !~ ' I$' OR cp.internal_ref IS NULL) AS kg
  FROM public.canonical_stock_moves csm
  LEFT JOIN public.odoo_products op ON op.odoo_product_id=csm.odoo_product_id
  LEFT JOIN public.canonical_products cp ON cp.odoo_product_id=csm.odoo_product_id
  LEFT JOIN public.product_kg_per_unit kpu ON kpu.odoo_product_id=csm.odoo_product_id
  WHERE csm.reference LIKE 'TL/INSP%' AND csm.state='done'
    AND csm.date >= date_trunc('month', CURRENT_DATE) - p_months_back * interval '1 month'
    AND csm.quantity>0 AND (op.uom='m' OR op.uom IS NULL)
  GROUP BY 1
),
ventas AS (
  SELECT to_char(il.invoice_date,'YYYY-MM') AS mes,
    SUM(CASE WHEN op.uom='m' THEN il.quantity WHEN op.uom='kg' THEN il.quantity*COALESCE(puc.m_per_kg,0) ELSE 0 END) AS m_equiv,
    SUM(il.quantity * COALESCE(kpu.kg_per_unit,0)) AS kg
  FROM (SELECT DISTINCT ON (odoo_move_id, odoo_product_id, quantity) odoo_move_id, odoo_product_id, quantity, invoice_date
        FROM public.odoo_invoice_lines WHERE move_type='out_invoice' AND odoo_product_id IS NOT NULL) il
  LEFT JOIN public.odoo_products op ON op.odoo_product_id=il.odoo_product_id
  LEFT JOIN public.product_uom_conversion puc ON puc.odoo_product_id=il.odoo_product_id
  LEFT JOIN public.product_kg_per_unit kpu ON kpu.odoo_product_id=il.odoo_product_id
  GROUP BY 1
),
gastos AS (
  SELECT period AS mes,
    SUM(balance) FILTER (WHERE account_code LIKE '501.06%' OR account_code LIKE '504.01%'
      OR account_code ~ '^504\.(0[89]|1[0-9]|2[0-3])') AS fab,
    SUM(balance) FILTER (WHERE account_code LIKE '6%') AS op
  FROM public.odoo_account_balances GROUP BY 1
)
SELECT mo.mes, COALESCE(m.m,0)::numeric, COALESCE(i.m,0)::numeric, COALESCE(v.m_equiv,0)::numeric,
  COALESCE(g.fab,0)::numeric, COALESCE(g.op,0)::numeric,
  CASE WHEN COALESCE(m.m,0)>0 THEN ROUND((g.fab/m.m)::numeric,4) END,
  CASE WHEN COALESCE(m.m,0)>0 THEN ROUND((g.op/m.m)::numeric,4) END,
  CASE WHEN COALESCE(m.m,0)>0 THEN ROUND(((COALESCE(g.fab,0)+COALESCE(g.op,0))/m.m)::numeric,4) END,
  CASE WHEN COALESCE(i.m,0)>0 THEN ROUND((g.fab/i.m)::numeric,4) END,
  CASE WHEN COALESCE(i.m,0)>0 THEN ROUND((g.op/i.m)::numeric,4) END,
  CASE WHEN COALESCE(i.m,0)>0 THEN ROUND(((COALESCE(g.fab,0)+COALESCE(g.op,0))/i.m)::numeric,4) END,
  CASE WHEN COALESCE(v.m_equiv,0)>0 THEN ROUND((g.op/v.m_equiv)::numeric,4) END,
  COALESCE(i.kg,0)::numeric, COALESCE(v.kg,0)::numeric,
  CASE WHEN COALESCE(i.kg,0)>0 THEN ROUND((g.fab/i.kg)::numeric,4) END,
  CASE WHEN COALESCE(v.kg,0)>0 THEN ROUND((g.op/v.kg)::numeric,4) END,
  CASE WHEN COALESCE(i.kg,0)>0 AND COALESCE(v.kg,0)>0 THEN ROUND((g.fab/i.kg + g.op/v.kg)::numeric,4) END
FROM months mo
LEFT JOIN metros m ON m.mes=mo.mes LEFT JOIN insp i ON i.mes=mo.mes
LEFT JOIN ventas v ON v.mes=mo.mes LEFT JOIN gastos g ON g.mes=mo.mes
ORDER BY mo.mes;
$function$;
