-- 2026-06-02b: RPC get_rama_burden_monthly — estudio de costo por metro
-- producido en la rama (órdenes TL/OP-ACA, proceso de acabado).
--
-- Pedido del CEO (2026-06-02):
--   1. Gas: precio unitario y gasto ÷ metros producidos en OP-ACA → gas $/metro.
--      Alerta cuando supera $0.75/mt (señal de baja eficiencia de la rama).
--   2. Gastos de fabricación (todo el costo de producción SIN costo primo MP):
--      MOD (501.06) + overhead fábrica (504.01) [+ depreciación fábrica
--      504.08-23 como vista opcional] ÷ metros OP-ACA → fabricación $/metro.
--
-- Hallazgos del estudio inicial (Ene-May 2026):
--   - Gas $/metro: $0.61–$1.00 (promedio $0.73). El precio del litro es
--     estable ($8.70-$9.15); la variación viene de la eficiencia operativa.
--     Más metros = menor costo/mt (costo base fijo de calentar la rama).
--   - Gastos fabricación $/metro: ~$6.26 promedio (sin depreciación).
--
-- Fuentes:
--   - Metros: odoo_manufacturing, name LIKE 'TL/OP-ACA%', state='done'
--   - Gas contable: 504.01.0003 GAS Y/O DIESEL (fallback: compras GASLP)
--   - Gas litros/precio: odoo_order_lines purchase product_ref='GASLP'
--   - MOD: 501.06.* / Overhead fábrica: 504.01.* / Dep fábrica: 504.08-504.23
--
-- Nota: las OPs de acabado existen en Odoo desde enero 2026; meses
-- anteriores regresan metros=0 y per-meter NULL.

CREATE OR REPLACE FUNCTION public.get_rama_burden_monthly(p_months_back integer DEFAULT 12)
RETURNS TABLE(
  mes text,
  ops_terminadas bigint,
  metros_op_aca numeric,
  gas_litros numeric,
  gas_precio_litro numeric,
  gas_gasto_mxn numeric,
  gas_por_metro numeric,
  mod_mxn numeric,
  overhead_mxn numeric,
  depreciacion_mxn numeric,
  gastos_fabricacion_mxn numeric,
  fabricacion_por_metro numeric,
  fabricacion_con_dep_por_metro numeric
)
LANGUAGE sql
STABLE
AS $function$
WITH months AS (
  SELECT to_char(gs, 'YYYY-MM') AS mes
  FROM generate_series(
    date_trunc('month', CURRENT_DATE) - (p_months_back - 1) * interval '1 month',
    date_trunc('month', CURRENT_DATE),
    interval '1 month'
  ) gs
),
produccion AS (
  -- Metros terminados en la rama (acabado). Todo OP-ACA es en metros.
  SELECT to_char(COALESCE(date_finished, date_start), 'YYYY-MM') AS mes,
         COUNT(*) AS ops,
         SUM(qty_produced) AS metros
  FROM public.odoo_manufacturing
  WHERE name LIKE 'TL/OP-ACA%' AND state = 'done' AND qty_produced > 0
  GROUP BY 1
),
gas_compras AS (
  -- Compras de GAS LP: litros y gasto (para precio unitario)
  SELECT to_char(order_date, 'YYYY-MM') AS mes,
         SUM(qty) AS litros,
         SUM(subtotal) AS gasto
  FROM public.odoo_order_lines
  WHERE order_type = 'purchase' AND product_ref = 'GASLP'
  GROUP BY 1
),
contable AS (
  SELECT period AS mes,
    SUM(balance) FILTER (WHERE account_code LIKE '504.01.0003%') AS gas_contable,
    SUM(balance) FILTER (WHERE account_code LIKE '501.06%')      AS mod,
    SUM(balance) FILTER (WHERE account_code LIKE '504.01%')      AS overhead,
    SUM(balance) FILTER (WHERE account_code ~ '^504\.(0[89]|1[0-9]|2[0-3])') AS dep
  FROM public.odoo_account_balances
  GROUP BY period
)
SELECT
  m.mes,
  COALESCE(p.ops, 0)::bigint                                          AS ops_terminadas,
  COALESCE(p.metros, 0)::numeric                                      AS metros_op_aca,
  COALESCE(g.litros, 0)::numeric                                      AS gas_litros,
  CASE WHEN COALESCE(g.litros, 0) > 0
       THEN ROUND((g.gasto / g.litros)::numeric, 2) END               AS gas_precio_litro,
  ROUND(COALESCE(c.gas_contable, g.gasto, 0)::numeric, 0)             AS gas_gasto_mxn,
  CASE WHEN COALESCE(p.metros, 0) > 0
       THEN ROUND((COALESCE(c.gas_contable, g.gasto, 0) / p.metros)::numeric, 3) END AS gas_por_metro,
  ROUND(COALESCE(c.mod, 0)::numeric, 0)                               AS mod_mxn,
  ROUND(COALESCE(c.overhead, 0)::numeric, 0)                          AS overhead_mxn,
  ROUND(COALESCE(c.dep, 0)::numeric, 0)                               AS depreciacion_mxn,
  ROUND((COALESCE(c.mod, 0) + COALESCE(c.overhead, 0))::numeric, 0)   AS gastos_fabricacion_mxn,
  CASE WHEN COALESCE(p.metros, 0) > 0
       THEN ROUND(((COALESCE(c.mod, 0) + COALESCE(c.overhead, 0)) / p.metros)::numeric, 2) END AS fabricacion_por_metro,
  CASE WHEN COALESCE(p.metros, 0) > 0
       THEN ROUND(((COALESCE(c.mod, 0) + COALESCE(c.overhead, 0) + COALESCE(c.dep, 0)) / p.metros)::numeric, 2) END AS fabricacion_con_dep_por_metro
FROM months m
LEFT JOIN produccion p ON p.mes = m.mes
LEFT JOIN gas_compras g ON g.mes = m.mes
LEFT JOIN contable c ON c.mes = m.mes
ORDER BY m.mes;
$function$;

COMMENT ON FUNCTION public.get_rama_burden_monthly(integer) IS
  'Costo por metro producido en la rama (OP-ACA): gas $/mt (alerta >$0.75) y '
  'gastos de fabricación (MOD 501.06 + OH fábrica 504.01, sin costo primo MP) $/mt. '
  'Consumido por /contabilidad/centros-de-costo (RamaBurdenCard).';
