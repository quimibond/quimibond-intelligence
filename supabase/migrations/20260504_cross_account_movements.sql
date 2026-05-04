-- /contabilidad/movimientos — análisis cross-account
--
-- Para un mes específico, encuentra TODAS las cuentas P&L con cambio
-- material vs:
--   - Mes anterior (MoM)
--   - Promedio últimos 3 meses cerrados (run rate)
--   - Mismo mes año anterior (YoY)
--
-- Cada cuenta marca is_anomaly=true si:
--   - cambio absoluto > 2× el promedio 3m, O
--   - cambio absoluto > $500k
--
-- Use case: el CEO ve inmediatamente "estos son los 10 lugares donde
-- el dinero se movió más fuera de lo normal" sin tener que adivinar.

CREATE OR REPLACE FUNCTION public.get_cross_account_movements(
  p_period text,
  p_min_abs_change numeric DEFAULT 50000
)
RETURNS TABLE(
  account_code text,
  account_name text,
  account_type text,
  bucket text,
  curr_mxn numeric,
  prev_mxn numeric,
  avg3m_mxn numeric,
  yoy_mxn numeric,
  delta_mom_abs numeric,
  delta_mom_pct numeric,
  delta_vs_avg_abs numeric,
  delta_vs_avg_pct numeric,
  delta_yoy_abs numeric,
  delta_yoy_pct numeric,
  is_anomaly boolean
)
LANGUAGE sql STABLE
AS $function$
WITH params AS (
  SELECT
    p_period AS curr,
    to_char((p_period || '-01')::date - interval '1 month', 'YYYY-MM') AS prev,
    to_char((p_period || '-01')::date - interval '12 months', 'YYYY-MM') AS yoy
),
periods AS (
  SELECT generate_series(
    (p_period || '-01')::date - interval '12 months',
    (p_period || '-01')::date,
    interval '1 month'
  )::date AS period_date
),
period_keys AS (
  SELECT to_char(period_date, 'YYYY-MM') AS period FROM periods
),
balances AS (
  SELECT
    cab.account_code,
    cab.account_name,
    cab.account_type,
    cab.balance_sheet_bucket,
    cab.period,
    cab.balance
  FROM public.canonical_account_balances cab
  WHERE cab.deprecated = false
    AND cab.balance_sheet_bucket IN ('income','expense')
    AND cab.period IN (SELECT period FROM period_keys)
),
classified AS (
  SELECT
    b.account_code,
    b.account_name,
    b.account_type,
    CASE
      WHEN b.balance_sheet_bucket='income' AND b.account_code LIKE '4%' THEN 'income_4xx'
      WHEN b.balance_sheet_bucket='income' AND b.account_code LIKE '7%' THEN 'income_7xx'
      WHEN b.account_code LIKE '501.01%' THEN 'cogs_501_01'
      WHEN b.account_code LIKE '501.06%' THEN 'mod_501_06'
      WHEN b.account_code LIKE '502%' THEN 'compras_502'
      WHEN b.account_code LIKE '504%' AND b.account_type='expense_depreciation' THEN 'dep_504_08_23'
      WHEN b.account_code LIKE '504%' THEN 'overhead_504_01'
      WHEN b.account_code LIKE '6%' AND b.account_type='expense_depreciation' THEN 'dep_corpo_613'
      WHEN b.account_code LIKE '6%' THEN 'gastos_op_6xx'
      ELSE 'otro'
    END AS bucket,
    b.period,
    -- contribución signed: income negar (más ingreso = positivo); expense as-is
    CASE WHEN b.balance_sheet_bucket='income' THEN -b.balance ELSE b.balance END AS amount
  FROM balances b
),
agg AS (
  SELECT
    c.account_code,
    MAX(c.account_name) AS account_name,
    MAX(c.account_type) AS account_type,
    MAX(c.bucket) AS bucket,
    SUM(CASE WHEN c.period = (SELECT curr FROM params) THEN c.amount ELSE 0 END) AS curr_mxn,
    SUM(CASE WHEN c.period = (SELECT prev FROM params) THEN c.amount ELSE 0 END) AS prev_mxn,
    SUM(CASE WHEN c.period = (SELECT yoy FROM params) THEN c.amount ELSE 0 END) AS yoy_mxn,
    AVG(c.amount) FILTER (WHERE c.period IN (
      to_char((p_period || '-01')::date - interval '1 month', 'YYYY-MM'),
      to_char((p_period || '-01')::date - interval '2 months', 'YYYY-MM'),
      to_char((p_period || '-01')::date - interval '3 months', 'YYYY-MM')
    )) AS avg3m_mxn
  FROM classified c
  GROUP BY c.account_code
)
SELECT
  a.account_code,
  a.account_name,
  a.account_type,
  a.bucket,
  ROUND(a.curr_mxn::numeric, 2) AS curr_mxn,
  ROUND(a.prev_mxn::numeric, 2) AS prev_mxn,
  ROUND(COALESCE(a.avg3m_mxn, 0)::numeric, 2) AS avg3m_mxn,
  ROUND(a.yoy_mxn::numeric, 2) AS yoy_mxn,
  ROUND((a.curr_mxn - a.prev_mxn)::numeric, 2) AS delta_mom_abs,
  CASE WHEN ABS(a.prev_mxn) > 100
    THEN ROUND(((a.curr_mxn - a.prev_mxn) / ABS(a.prev_mxn) * 100)::numeric, 1)
    ELSE NULL END AS delta_mom_pct,
  ROUND((a.curr_mxn - COALESCE(a.avg3m_mxn, 0))::numeric, 2) AS delta_vs_avg_abs,
  CASE WHEN ABS(COALESCE(a.avg3m_mxn, 0)) > 100
    THEN ROUND(((a.curr_mxn - a.avg3m_mxn) / ABS(a.avg3m_mxn) * 100)::numeric, 1)
    ELSE NULL END AS delta_vs_avg_pct,
  ROUND((a.curr_mxn - a.yoy_mxn)::numeric, 2) AS delta_yoy_abs,
  CASE WHEN ABS(a.yoy_mxn) > 100
    THEN ROUND(((a.curr_mxn - a.yoy_mxn) / ABS(a.yoy_mxn) * 100)::numeric, 1)
    ELSE NULL END AS delta_yoy_pct,
  (
    (ABS(COALESCE(a.avg3m_mxn, 0)) > 100 AND ABS(a.curr_mxn - a.avg3m_mxn) > ABS(a.avg3m_mxn) * 2)
    OR ABS(a.curr_mxn - COALESCE(a.avg3m_mxn, 0)) > 500000
  ) AS is_anomaly
FROM agg a
WHERE ABS(a.curr_mxn - a.prev_mxn) >= p_min_abs_change
   OR ABS(a.curr_mxn - COALESCE(a.avg3m_mxn, 0)) >= p_min_abs_change
ORDER BY ABS(a.curr_mxn - COALESCE(a.avg3m_mxn, 0)) DESC;
$function$;
