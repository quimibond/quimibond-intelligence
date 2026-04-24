-- F-COGS cache: serie histórica mensual precomputada.
--
-- PROBLEMA: get_cogs_comparison_monthly hacía LATERAL JOIN de 28+ meses
-- contra get_cogs_recursive_mp (BOM recursivo). Total ~25s para 28 meses.
-- En la UI, filtrar por "all" o "y:2024" disparaba ese cálculo cada vez.
--
-- SOLUCIÓN: cache en tabla cogs_monthly_cache refrescada nightly via
-- Vercel Cron (/api/pipeline/refresh-cogs-monthly, 03:30 UTC).
-- execute_safe_ddl() no permite MATERIALIZED VIEW, así que usamos
-- tabla + función refresh + INSERT ... ON CONFLICT.
--
-- Split de funciones:
--   _compute_cogs_comparison_monthly(from,to)  — la versión pesada
--   refresh_cogs_monthly_cache(from_month)      — upsert en cache
--   get_cogs_comparison_monthly(from,to)        — lee del cache (reescrita)

-- Tabla cache
CREATE TABLE IF NOT EXISTS public.cogs_monthly_cache (
  period text PRIMARY KEY,
  revenue_product_mxn numeric NOT NULL DEFAULT 0,
  revenue_invoices_mxn numeric NOT NULL DEFAULT 0,
  cogs_contable_mxn numeric NOT NULL DEFAULT 0,
  cogs_capa_valoracion_mxn numeric NOT NULL DEFAULT 0,
  cogs_contable_raw_mxn numeric NOT NULL DEFAULT 0,
  cogs_recursive_mp_mxn numeric NOT NULL DEFAULT 0,
  overhead_mxn numeric NOT NULL DEFAULT 0,
  margin_contable_pct numeric,
  margin_raw_pct numeric,
  margin_recursive_pct numeric,
  lines_total bigint NOT NULL DEFAULT 0,
  lines_with_cost bigint NOT NULL DEFAULT 0,
  bom_coverage_pct numeric NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now()
);

-- Compute function (heavy). Antes era el cuerpo de
-- get_cogs_comparison_monthly. Ahora vive en _compute para evitar
-- recursión con el lector cacheado.
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
WITH months AS (
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
  FROM public.canonical_account_balances
  WHERE balance_sheet_bucket = 'income' AND deprecated = false AND account_code LIKE '4%'
    AND period >= to_char(p_date_from, 'YYYY-MM')
    AND period < to_char(p_date_to, 'YYYY-MM')
  GROUP BY period
),
cogs_contable AS (
  SELECT period::text AS period, COALESCE(SUM(balance), 0)::numeric AS cogs_mxn
  FROM public.canonical_account_balances
  WHERE account_type = 'expense_direct_cost' AND deprecated = false
    AND period >= to_char(p_date_from, 'YYYY-MM')
    AND period < to_char(p_date_to, 'YYYY-MM')
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

-- Refresh (upsert). Llamado por /api/pipeline/refresh-cogs-monthly nightly.
CREATE OR REPLACE FUNCTION public.refresh_cogs_monthly_cache(
  p_from_month text DEFAULT '2024-01'
)
RETURNS integer
LANGUAGE plpgsql
AS $fn$
DECLARE v_count integer := 0;
BEGIN
  INSERT INTO public.cogs_monthly_cache AS c (
    period, revenue_product_mxn, revenue_invoices_mxn, cogs_contable_mxn,
    cogs_capa_valoracion_mxn, cogs_contable_raw_mxn, cogs_recursive_mp_mxn,
    overhead_mxn, margin_contable_pct, margin_raw_pct, margin_recursive_pct,
    lines_total, lines_with_cost, bom_coverage_pct, computed_at
  )
  SELECT
    period, revenue_product_mxn, revenue_invoices_mxn, cogs_contable_mxn,
    cogs_capa_valoracion_mxn, cogs_contable_raw_mxn, cogs_recursive_mp_mxn,
    overhead_mxn, margin_contable_pct, margin_raw_pct, margin_recursive_pct,
    lines_total, lines_with_cost, bom_coverage_pct, now()
  FROM public._compute_cogs_comparison_monthly(
    (p_from_month || '-01')::date,
    (date_trunc('month', CURRENT_DATE) + interval '1 month')::date
  )
  ON CONFLICT (period) DO UPDATE SET
    revenue_product_mxn = EXCLUDED.revenue_product_mxn,
    revenue_invoices_mxn = EXCLUDED.revenue_invoices_mxn,
    cogs_contable_mxn = EXCLUDED.cogs_contable_mxn,
    cogs_capa_valoracion_mxn = EXCLUDED.cogs_capa_valoracion_mxn,
    cogs_contable_raw_mxn = EXCLUDED.cogs_contable_raw_mxn,
    cogs_recursive_mp_mxn = EXCLUDED.cogs_recursive_mp_mxn,
    overhead_mxn = EXCLUDED.overhead_mxn,
    margin_contable_pct = EXCLUDED.margin_contable_pct,
    margin_raw_pct = EXCLUDED.margin_raw_pct,
    margin_recursive_pct = EXCLUDED.margin_recursive_pct,
    lines_total = EXCLUDED.lines_total,
    lines_with_cost = EXCLUDED.lines_with_cost,
    bom_coverage_pct = EXCLUDED.bom_coverage_pct,
    computed_at = now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$fn$;

-- Reader (fast). Ahora lee del cache en vez de recomputar.
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
  AND c.period < to_char(p_date_to, 'YYYY-MM')
ORDER BY c.period;
$fn$;

-- Primera carga inicial (idempotente gracias a ON CONFLICT)
SELECT public.refresh_cogs_monthly_cache('2024-01');
