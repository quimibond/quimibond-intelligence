-- 2026-06-04: Agrega metros de INSPECCIÓN (TL/INSP, operación de inventario)
-- como denominador alternativo del factor $/metro, para comparar contra
-- OP-ACA + OP-V10 (acabado). El CEO quiere ver ambos lado a lado.
--
-- Inspección = transferencias internas TL/INSP/* (move_category transfer_interno)
-- — el último gate donde se mide toda la tela vendible sin importar su ruta.
-- Riesgo: posible doble conteo si un rollo se reinspecciona/parte (se muestra
-- como comparación, no se adopta como oficial todavía).
--
-- get_cost_factors_monthly y get_meters_produced_vs_sold ganan columnas de
-- inspección. get_full_cost_reconstruction NO cambia (sigue en OP-ACA+V10).

CREATE OR REPLACE FUNCTION public.get_cost_factors_monthly(p_months_back integer DEFAULT 12)
RETURNS TABLE(
  mes text,
  metros_referencia numeric,
  metros_inspeccion numeric,
  gastos_fabricacion_mxn numeric,
  gastos_operacion_mxn numeric,
  factor_fab_x_metro numeric,
  factor_op_x_metro numeric,
  factor_total_x_metro numeric,
  factor_fab_insp numeric,
  factor_op_insp numeric,
  factor_total_insp numeric
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
  COALESCE(i.m, 0)::numeric,
  COALESCE(g.fab, 0)::numeric,
  COALESCE(g.op, 0)::numeric,
  CASE WHEN COALESCE(m.m,0) > 0 THEN ROUND((g.fab / m.m)::numeric, 4) END,
  CASE WHEN COALESCE(m.m,0) > 0 THEN ROUND((g.op / m.m)::numeric, 4) END,
  CASE WHEN COALESCE(m.m,0) > 0 THEN ROUND(((COALESCE(g.fab,0) + COALESCE(g.op,0)) / m.m)::numeric, 4) END,
  CASE WHEN COALESCE(i.m,0) > 0 THEN ROUND((g.fab / i.m)::numeric, 4) END,
  CASE WHEN COALESCE(i.m,0) > 0 THEN ROUND((g.op / i.m)::numeric, 4) END,
  CASE WHEN COALESCE(i.m,0) > 0 THEN ROUND(((COALESCE(g.fab,0) + COALESCE(g.op,0)) / i.m)::numeric, 4) END
FROM months mo
LEFT JOIN metros m ON m.mes = mo.mes
LEFT JOIN insp i ON i.mes = mo.mes
LEFT JOIN gastos g ON g.mes = mo.mes
ORDER BY mo.mes;
$function$;

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
  CASE WHEN (COALESCE(p.aca,0) + COALESCE(p.v10,0)) > 0
       THEN ROUND(COALESCE(v.metros,0) / (COALESCE(p.aca,0) + COALESCE(p.v10,0)), 2) END
FROM months mo
LEFT JOIN prod p ON p.mes = mo.mes
LEFT JOIN insp i ON i.mes = mo.mes
LEFT JOIN ventas v ON v.mes = mo.mes
ORDER BY mo.mes;
$function$;
