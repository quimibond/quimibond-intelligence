-- /reporte/[period] — driver decomposition Mes vs Mes anterior
--
-- Descomposición tipo CFO de qué movió la utilidad este mes vs el mes anterior:
--
-- 1. Cambio en revenue: por cliente (gain/loss)
-- 2. Cambio en costo MP: por producto (volume × price)
-- 3. Cambio en gastos: por cuenta GL
-- 4. Cambio en otros: 7xx breakdown
--
-- Todo numérico (sin opinión) — el LLM/UI lo narra después.

CREATE OR REPLACE FUNCTION public.get_mom_revenue_drivers(
  p_period text  -- 'YYYY-MM' del mes actual
)
RETURNS TABLE(
  company_canonical_id bigint,
  company_name text,
  revenue_curr numeric,
  revenue_prev numeric,
  delta numeric,
  is_one_off boolean
)
LANGUAGE sql STABLE
AS $function$
WITH bounds AS (
  SELECT
    (p_period || '-01')::date AS curr_from,
    (date_trunc('month', (p_period || '-01')::date) + interval '1 month')::date AS curr_to,
    (date_trunc('month', (p_period || '-01')::date) - interval '1 month')::date AS prev_from,
    (p_period || '-01')::date AS prev_to
),
rev AS (
  SELECT
    il.company_id,
    CASE
      WHEN il.invoice_date >= b.curr_from AND il.invoice_date < b.curr_to THEN 'curr'
      WHEN il.invoice_date >= b.prev_from AND il.invoice_date < b.prev_to THEN 'prev'
    END AS bucket,
    SUM(CASE
      WHEN il.move_type = 'out_invoice' THEN il.price_subtotal_mxn
      WHEN il.move_type = 'out_refund' THEN -il.price_subtotal_mxn
      ELSE 0
    END) AS rev
  FROM public.odoo_invoice_lines il, bounds b
  WHERE il.move_type IN ('out_invoice', 'out_refund')
    AND il.invoice_date >= b.prev_from
    AND il.invoice_date < b.curr_to
    AND il.company_id IS NOT NULL
  GROUP BY il.company_id, bucket
),
pivoted AS (
  SELECT
    r.company_id,
    SUM(CASE WHEN r.bucket = 'curr' THEN r.rev ELSE 0 END) AS revenue_curr,
    SUM(CASE WHEN r.bucket = 'prev' THEN r.rev ELSE 0 END) AS revenue_prev
  FROM rev r
  WHERE r.bucket IS NOT NULL
  GROUP BY r.company_id
)
SELECT
  c.id::bigint AS company_canonical_id,
  c.canonical_name AS company_name,
  ROUND(p.revenue_curr::numeric, 2) AS revenue_curr,
  ROUND(p.revenue_prev::numeric, 2) AS revenue_prev,
  ROUND((p.revenue_curr - p.revenue_prev)::numeric, 2) AS delta,
  -- Heurística: si en este mes hay un cliente con factura única > $5M y el otro mes 0,
  -- probablemente sea one-off (venta de activo, contrato extraordinario)
  (GREATEST(p.revenue_curr, p.revenue_prev) > 5000000
    AND LEAST(p.revenue_curr, p.revenue_prev) < 100000) AS is_one_off
FROM pivoted p
JOIN public.companies c ON c.id = p.company_id
WHERE ABS(p.revenue_curr - p.revenue_prev) > 50000  -- filtra ruido
ORDER BY (p.revenue_curr - p.revenue_prev) DESC;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- Driver: cambio en cuentas GL (P&L) entre dos meses
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_mom_pnl_account_drivers(
  p_period text  -- 'YYYY-MM'
)
RETURNS TABLE(
  account_code text,
  account_name text,
  account_type text,
  bucket text,             -- 'income_4xx'|'income_7xx'|'cogs_501_01'|'mod_501_06'|'compras_502'|'overhead_504_01'|'dep_504_08_23'|'dep_corpo_613'|'gastos_op_6xx'
  curr_balance numeric,
  prev_balance numeric,
  delta numeric,           -- impacto en utilidad (positivo = mejora utilidad)
  is_significant boolean
)
LANGUAGE sql STABLE
AS $function$
WITH bounds AS (
  SELECT
    p_period AS curr,
    to_char((p_period || '-01')::date - interval '1 month', 'YYYY-MM') AS prev
),
classified AS (
  SELECT
    cab.account_code,
    cab.account_name,
    cab.account_type,
    cab.balance_sheet_bucket,
    CASE
      WHEN cab.balance_sheet_bucket='income' AND cab.account_code LIKE '4%' THEN 'income_4xx'
      WHEN cab.balance_sheet_bucket='income' AND cab.account_code LIKE '7%' THEN 'income_7xx'
      WHEN cab.account_code LIKE '501.01%' THEN 'cogs_501_01'
      WHEN cab.account_code LIKE '501.06%' THEN 'mod_501_06'
      WHEN cab.account_code LIKE '502%' THEN 'compras_502'
      WHEN cab.account_code LIKE '504%' AND cab.account_type='expense_depreciation' THEN 'dep_504_08_23'
      WHEN cab.account_code LIKE '504%' THEN 'overhead_504_01'
      WHEN cab.account_code LIKE '6%' AND cab.account_type='expense_depreciation' THEN 'dep_corpo_613'
      WHEN cab.account_code LIKE '6%' THEN 'gastos_op_6xx'
      ELSE 'otro'
    END AS bucket,
    cab.period,
    cab.balance,
    -- Signed contribution to net income: income negate, expense subtract
    CASE
      WHEN cab.balance_sheet_bucket='income' THEN -cab.balance
      ELSE -cab.balance  -- expense in stored sign positive → −balance reduces utility
    END AS contrib_to_utility
  FROM public.canonical_account_balances cab, bounds b
  WHERE cab.deprecated = false
    AND cab.period IN (b.curr, b.prev)
)
SELECT
  c.account_code,
  c.account_name,
  c.account_type,
  c.bucket,
  ROUND(SUM(CASE WHEN c.period = (SELECT curr FROM bounds) THEN c.balance ELSE 0 END)::numeric, 2) AS curr_balance,
  ROUND(SUM(CASE WHEN c.period = (SELECT prev FROM bounds) THEN c.balance ELSE 0 END)::numeric, 2) AS prev_balance,
  ROUND((SUM(CASE WHEN c.period = (SELECT curr FROM bounds) THEN c.contrib_to_utility ELSE 0 END)
       - SUM(CASE WHEN c.period = (SELECT prev FROM bounds) THEN c.contrib_to_utility ELSE 0 END))::numeric, 2) AS delta,
  ABS(SUM(CASE WHEN c.period = (SELECT curr FROM bounds) THEN c.contrib_to_utility ELSE 0 END)
    - SUM(CASE WHEN c.period = (SELECT prev FROM bounds) THEN c.contrib_to_utility ELSE 0 END)) > 100000 AS is_significant
FROM classified c
GROUP BY c.account_code, c.account_name, c.account_type, c.bucket
HAVING ABS(SUM(CASE WHEN c.period = (SELECT curr FROM bounds) THEN c.contrib_to_utility ELSE 0 END)
         - SUM(CASE WHEN c.period = (SELECT prev FROM bounds) THEN c.contrib_to_utility ELSE 0 END)) > 10000
ORDER BY delta;  -- worst impact first
$function$;
