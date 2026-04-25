-- F5+: cash projection con flujos recurrentes (nómina, renta, servicios,
-- arrendamiento, ventas proyectadas) además del AR/AP factura por factura.
--
-- ANTES: getCashProjection solo leía cashflow_projection (AR + AP de
-- facturas ya en el sistema). Faltaban ~$11M/mes de gastos recurrentes
-- (nómina ~$3.2M, renta ~$1.4M, servicios ~$1.0M, arrendamiento ~$0.8M)
-- y la cobranza esperada de ventas futuras (~$3-4M/mes con DSO actual).
-- Resultado: la proyección era OPTIMISTA, no incluía la mayoría de outflows.
--
-- AHORA: nuevo RPC `get_cash_projection_recurring(horizon_days, lookback_months)`
-- que detecta el patrón histórico de los últimos N meses cerrados y proyecta:
--
-- Outflows recurrentes (calendario típico):
--   nómina:        2 quincenas/mes (día 15 + último)
--   renta:         día 1
--   servicios:     día 10 (energía, gas, agua, mtto, telefonía, importación)
--   arrendamiento: día 5
--
-- Inflows recurrentes:
--   ventas_proyectadas: cobranza diaria a partir de today + DSO,
--                       monto = (run_rate / 30) × 0.85 prob
--
-- DSO se calcula dinámicamente: AR_open / (avg_monthly_revenue / 30).
-- Cap entre 15 y 120 días.
--
-- Cuentas categorizadas:
--   Nómina:    501.06.* + 602.01.* + 603.01.*
--   Renta:     504.01.0008 + 603.45.*
--   Servicios: 504.01.0002/0003/0004/0005/0023/0035/0040/0042/0043
--   Arrendam.: 701.11.*
--   Ventas:    4xx (negar — son income credit-normal)
--
-- Validación 2026 (lookback 3 meses ene-mar):
--   Nómina mensual:        $3.21M
--   Renta mensual:         $1.37M
--   Servicios mensual:     $1.54M
--   Arrendamiento mensual: $0.78M
--   Ventas mensual:       $12.68M

CREATE OR REPLACE FUNCTION public.get_cash_projection_recurring(
  p_horizon_days integer DEFAULT 90,
  p_lookback_months integer DEFAULT 3
)
RETURNS TABLE(
  projected_date date,
  category text,
  category_label text,
  flow_type text,
  amount_mxn numeric,
  probability numeric,
  notes text
)
LANGUAGE sql STABLE
AS $fn$
WITH lookback AS (
  SELECT
    to_char(date_trunc('month', (CURRENT_DATE - (p_lookback_months || ' month')::interval))::date, 'YYYY-MM') AS from_month,
    to_char((date_trunc('month', CURRENT_DATE) - interval '1 day')::date, 'YYYY-MM') AS to_month
),
monthly_avg AS (
  SELECT
    (SELECT COALESCE(AVG(monthly), 0)::numeric FROM (
      SELECT period, SUM(balance) AS monthly
      FROM public.canonical_account_balances, lookback lb
      WHERE deprecated = false
        AND (account_code LIKE '501.06%' OR account_code LIKE '602.01%' OR account_code LIKE '603.01%')
        AND period >= lb.from_month AND period <= lb.to_month
      GROUP BY period
    ) t) AS nomina,
    (SELECT COALESCE(AVG(monthly), 0)::numeric FROM (
      SELECT period, SUM(balance) AS monthly
      FROM public.canonical_account_balances, lookback lb
      WHERE deprecated = false
        AND (account_code LIKE '504.01.0008%' OR account_code LIKE '603.45%')
        AND period >= lb.from_month AND period <= lb.to_month
      GROUP BY period
    ) t) AS renta,
    (SELECT COALESCE(AVG(monthly), 0)::numeric FROM (
      SELECT period, SUM(balance) AS monthly
      FROM public.canonical_account_balances, lookback lb
      WHERE deprecated = false
        AND (
          account_code LIKE '504.01.0002%' OR account_code LIKE '504.01.0003%' OR
          account_code LIKE '504.01.0004%' OR account_code LIKE '504.01.0005%' OR
          account_code LIKE '504.01.0023%' OR account_code LIKE '504.01.0035%' OR
          account_code LIKE '504.01.0040%' OR account_code LIKE '504.01.0042%' OR
          account_code LIKE '504.01.0043%'
        )
        AND period >= lb.from_month AND period <= lb.to_month
      GROUP BY period
    ) t) AS servicios,
    (SELECT COALESCE(AVG(monthly), 0)::numeric FROM (
      SELECT period, SUM(balance) AS monthly
      FROM public.canonical_account_balances, lookback lb
      WHERE deprecated = false AND account_code LIKE '701.11%'
        AND period >= lb.from_month AND period <= lb.to_month
      GROUP BY period
    ) t) AS arrendamiento,
    (SELECT COALESCE(-AVG(monthly), 0)::numeric FROM (
      SELECT period, SUM(balance) AS monthly
      FROM public.canonical_account_balances, lookback lb
      WHERE deprecated = false AND balance_sheet_bucket = 'income' AND account_code LIKE '4%'
        AND period >= lb.from_month AND period <= lb.to_month
      GROUP BY period
    ) t) AS ventas
),
ar_total AS (
  SELECT COALESCE(SUM(amount_residual_mxn_resolved), 0)::numeric AS total
  FROM public.canonical_invoices
  WHERE direction = 'issued' AND amount_residual_mxn_resolved > 0
    AND COALESCE(estado_sat, '') <> 'cancelado'
),
dso_calc AS (
  SELECT GREATEST(15, LEAST(120,
    CASE WHEN ma.ventas > 0 THEN ROUND(ar.total / (ma.ventas / 30)) ELSE 60 END
  ))::int AS days
  FROM monthly_avg ma, ar_total ar
),
horizon_months AS (
  SELECT generate_series(
    date_trunc('month', CURRENT_DATE)::date,
    (CURRENT_DATE + (p_horizon_days || ' day')::interval)::date,
    interval '1 month'
  )::date AS month_start
),
all_flows AS (
  SELECT
    (hm.month_start + interval '14 day')::date AS pdate,
    'nomina'::text AS pcat, 'Nómina (quincena 15)'::text AS plabel,
    'recurring_outflow'::text AS pflow,
    (ma.nomina / 2)::numeric AS pamount, 1.0::numeric AS pprob,
    'Promedio últimos meses, día 15'::text AS pnotes
  FROM horizon_months hm, monthly_avg ma
  WHERE (hm.month_start + interval '14 day')::date BETWEEN CURRENT_DATE AND (CURRENT_DATE + (p_horizon_days || ' day')::interval)::date
    AND ma.nomina > 0
  UNION ALL
  SELECT
    (hm.month_start + interval '1 month' - interval '1 day')::date,
    'nomina', 'Nómina (quincena fin de mes)', 'recurring_outflow',
    (ma.nomina / 2)::numeric, 1.0, 'Promedio últimos meses, último día'
  FROM horizon_months hm, monthly_avg ma
  WHERE (hm.month_start + interval '1 month' - interval '1 day')::date BETWEEN CURRENT_DATE AND (CURRENT_DATE + (p_horizon_days || ' day')::interval)::date
    AND ma.nomina > 0
  UNION ALL
  SELECT hm.month_start, 'renta', 'Renta del local', 'recurring_outflow',
    ma.renta::numeric, 1.0, 'Promedio últimos meses, día 1'
  FROM horizon_months hm, monthly_avg ma
  WHERE hm.month_start BETWEEN CURRENT_DATE AND (CURRENT_DATE + (p_horizon_days || ' day')::interval)::date
    AND ma.renta > 0
  UNION ALL
  SELECT (hm.month_start + interval '9 day')::date,
    'servicios', 'Servicios (energía/agua/gas/mtto)', 'recurring_outflow',
    ma.servicios::numeric, 1.0, 'Promedio últimos meses, día 10'
  FROM horizon_months hm, monthly_avg ma
  WHERE (hm.month_start + interval '9 day')::date BETWEEN CURRENT_DATE AND (CURRENT_DATE + (p_horizon_days || ' day')::interval)::date
    AND ma.servicios > 0
  UNION ALL
  SELECT (hm.month_start + interval '4 day')::date,
    'arrendamiento', 'Arrendamiento financiero', 'recurring_outflow',
    ma.arrendamiento::numeric, 1.0, 'Promedio últimos meses, día 5'
  FROM horizon_months hm, monthly_avg ma
  WHERE (hm.month_start + interval '4 day')::date BETWEEN CURRENT_DATE AND (CURRENT_DATE + (p_horizon_days || ' day')::interval)::date
    AND ma.arrendamiento > 0
  UNION ALL
  SELECT gen.day::date,
    'ventas_proyectadas', 'Cobranza ventas futuras', 'recurring_inflow',
    (ma.ventas / 30 * 0.85)::numeric, 0.85,
    ('Run rate diario × 85% prob (DSO ' || d.days || 'd)')::text
  FROM monthly_avg ma, dso_calc d,
    LATERAL generate_series(
      CURRENT_DATE + (d.days || ' day')::interval,
      CURRENT_DATE + (p_horizon_days || ' day')::interval,
      interval '1 day'
    ) gen(day)
  WHERE ma.ventas > 0
)
SELECT pdate, pcat, plabel, pflow, pamount, pprob, pnotes
FROM all_flows
ORDER BY pdate, pcat;
$fn$;
