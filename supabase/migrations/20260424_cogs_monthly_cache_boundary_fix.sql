-- BUGFIX: month boundary inclusive en get_product_sales_revenue,
-- _compute_cogs_comparison_monthly, get_cogs_comparison_monthly (reader).
--
-- Caso observado por user: Break-even Card mostraba $38M YTD 2026, P&L
-- mostraba $48.3M. Gap = $10.3M = ventas de abril, excluidas en el
-- cálculo del break-even.
--
-- ROOT CAUSE: period < to_char(p_date_to, 'YYYY-MM')
--   Cuando p_date_to = 2026-04-25 (YTD parcial):
--     to_char(p_date_to, 'YYYY-MM') = '2026-04'
--     period < '2026-04' → excluye abril (solo ene/feb/mar)
--
-- FIX: usar to_char(p_date_to - 1 día, 'YYYY-MM') con `<=`:
--   Cuando p_date_to = 2026-04-25:
--     to_char((p_date_to - 1)::date, 'YYYY-MM') = '2026-04'
--     period <= '2026-04' → incluye abril ✓
--   Cuando p_date_to = 2026-05-01 (m:2026-04 mes completo):
--     to_char((2026-05-01 - 1)::date, 'YYYY-MM') = '2026-04'
--     period <= '2026-04' → incluye abril, excluye mayo ✓
--
-- También se refresca el cache por si había valores stale con el bug
-- original (aunque era idempotente, los meses ya estaban correctos).

CREATE OR REPLACE FUNCTION public.get_product_sales_revenue(
  p_date_from date,
  p_date_to date
)
RETURNS numeric
LANGUAGE sql STABLE
AS $fn$
  SELECT COALESCE(-SUM(balance), 0)::numeric
  FROM public.canonical_account_balances
  WHERE balance_sheet_bucket = 'income'
    AND deprecated = false
    AND account_code LIKE '4%'
    AND period >= to_char(p_date_from, 'YYYY-MM')
    AND period <= to_char((p_date_to - interval '1 day')::date, 'YYYY-MM');
$fn$;

-- _compute_cogs_comparison_monthly: ajusta dos subqueries que también
-- usaban `period < to_char(p_date_to, 'YYYY-MM')`. Ahora definimos un
-- CTE `bounds` con to_month_inclusive para usarlo consistentemente.
CREATE OR REPLACE FUNCTION public._compute_cogs_comparison_monthly(
  p_date_from date,
  p_date_to date
)
RETURNS TABLE(
  period text,
  revenue_product_mxn numeric,
  revenue_invoices_mxn numeric,
  cogs_contable_mxn numeric,
  cogs_capa_valoracion_mxn numeric,
  cogs_contable_raw_mxn numeric,
  cogs_recursive_mp_mxn numeric,
  overhead_mxn numeric,
  margin_contable_pct numeric,
  margin_raw_pct numeric,
  margin_recursive_pct numeric,
  lines_total bigint,
  lines_with_cost bigint,
  bom_coverage_pct numeric
)
LANGUAGE sql STABLE
AS $fn$
WITH bounds AS (
  SELECT
    to_char(p_date_from, 'YYYY-MM') AS from_month,
    to_char((p_date_to - interval '1 day')::date, 'YYYY-MM') AS to_month_inclusive
),
months AS (
  SELECT
    to_char(gs::date, 'YYYY-MM') AS period,
    gs::date AS month_start,
    (gs + interval '1 month')::date AS month_end
  FROM generate_series(
    date_trunc('month', p_date_from),
    date_trunc('month', (p_date_to - interval '1 day')::date),
    interval '1 month'
  ) gs
),
revenue_4xx AS (
  SELECT period::text AS period, COALESCE(-SUM(balance), 0)::numeric AS revenue_mxn
  FROM public.canonical_account_balances, bounds
  WHERE balance_sheet_bucket = 'income' AND deprecated = false AND account_code LIKE '4%'
    AND period >= bounds.from_month
    AND period <= bounds.to_month_inclusive
  GROUP BY period
),
cogs_contable AS (
  SELECT period::text AS period, COALESCE(SUM(balance), 0)::numeric AS cogs_mxn
  FROM public.canonical_account_balances, bounds
  WHERE account_type = 'expense_direct_cost' AND deprecated = false
    AND period >= bounds.from_month
    AND period <= bounds.to_month_inclusive
  GROUP BY period
),
capa AS (
  SELECT to_char(date_trunc('month', date)::date, 'YYYY-MM') AS period,
         COALESCE(SUM(amount_total), 0)::numeric AS capa_mxn
  FROM public.odoo_account_entries_stock
  WHERE journal_name = 'CAPA DE VALORACIÓN'
    AND date >= p_date_from AND date < p_date_to
  GROUP BY 1
),
rec AS (
  SELECT m.period, x.cogs_recursive_mp, x.lines_total, x.lines_with_cost
  FROM months m, LATERAL public.get_cogs_recursive_mp(m.month_start, m.month_end) x
),
invoices_rev AS (
  SELECT to_char(date_trunc('month', il.invoice_date)::date, 'YYYY-MM') AS period,
         COALESCE(SUM(il.price_subtotal_mxn), 0)::numeric AS revenue_mxn
  FROM public.odoo_invoice_lines il
  WHERE il.move_type = 'out_invoice'
    AND il.invoice_date >= p_date_from
    AND il.invoice_date < p_date_to
  GROUP BY 1
)
SELECT
  m.period,
  COALESCE(r4.revenue_mxn, 0),
  COALESCE(ir.revenue_mxn, 0),
  COALESCE(cc.cogs_mxn, 0),
  COALESCE(c.capa_mxn, 0),
  COALESCE(cc.cogs_mxn, 0) + COALESCE(c.capa_mxn, 0),
  COALESCE(rec.cogs_recursive_mp, 0),
  COALESCE(cc.cogs_mxn, 0) + COALESCE(c.capa_mxn, 0) - COALESCE(rec.cogs_recursive_mp, 0),
  CASE WHEN COALESCE(r4.revenue_mxn, 0) > 0
       THEN ROUND((r4.revenue_mxn - COALESCE(cc.cogs_mxn, 0)) / r4.revenue_mxn * 100, 1) END,
  CASE WHEN COALESCE(r4.revenue_mxn, 0) > 0
       THEN ROUND((r4.revenue_mxn - COALESCE(cc.cogs_mxn, 0) - COALESCE(c.capa_mxn, 0)) / r4.revenue_mxn * 100, 1) END,
  CASE WHEN COALESCE(r4.revenue_mxn, 0) > 0
       THEN ROUND((r4.revenue_mxn - COALESCE(rec.cogs_recursive_mp, 0)) / r4.revenue_mxn * 100, 1) END,
  COALESCE(rec.lines_total, 0),
  COALESCE(rec.lines_with_cost, 0),
  CASE WHEN COALESCE(rec.lines_total, 0) > 0
       THEN ROUND(rec.lines_with_cost::numeric / rec.lines_total * 100, 1) ELSE 0 END
FROM months m
LEFT JOIN revenue_4xx r4 ON r4.period = m.period
LEFT JOIN cogs_contable cc ON cc.period = m.period
LEFT JOIN capa c ON c.period = m.period
LEFT JOIN rec ON rec.period = m.period
LEFT JOIN invoices_rev ir ON ir.period = m.period
ORDER BY m.period;
$fn$;

CREATE OR REPLACE FUNCTION public.get_cogs_comparison_monthly(
  p_date_from date,
  p_date_to date
)
RETURNS TABLE(
  period text,
  revenue_product_mxn numeric,
  revenue_invoices_mxn numeric,
  cogs_contable_mxn numeric,
  cogs_capa_valoracion_mxn numeric,
  cogs_contable_raw_mxn numeric,
  cogs_recursive_mp_mxn numeric,
  overhead_mxn numeric,
  margin_contable_pct numeric,
  margin_raw_pct numeric,
  margin_recursive_pct numeric,
  lines_total bigint,
  lines_with_cost bigint,
  bom_coverage_pct numeric
)
LANGUAGE sql STABLE
AS $fn$
SELECT
  c.period, c.revenue_product_mxn, c.revenue_invoices_mxn, c.cogs_contable_mxn,
  c.cogs_capa_valoracion_mxn, c.cogs_contable_raw_mxn, c.cogs_recursive_mp_mxn,
  c.overhead_mxn, c.margin_contable_pct, c.margin_raw_pct, c.margin_recursive_pct,
  c.lines_total, c.lines_with_cost, c.bom_coverage_pct
FROM public.cogs_monthly_cache c
WHERE c.period >= to_char(p_date_from, 'YYYY-MM')
  AND c.period <= to_char((p_date_to - interval '1 day')::date, 'YYYY-MM')
ORDER BY c.period;
$fn$;

-- Forzar refresh del cache para que todos los valores queden con la
-- nueva lógica. Idempotente.
SELECT public.refresh_cogs_monthly_cache('2024-01');
