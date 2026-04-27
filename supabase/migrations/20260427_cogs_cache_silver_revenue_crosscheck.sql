-- Rewrite parcial de _compute_cogs_comparison_monthly: invoices_rev → silver
--
-- Cierra parcialmente Fase 2 Issue #3 del audit Supabase+Frontend 2026-04-27.
-- Migra el cross-check de revenue desde odoo_invoice_lines (bronze) a
-- canonical_invoices (silver). Mantiene CAPA leyendo bronze
-- odoo_account_entries_stock (semántica journal-entry-level no existe en
-- canonical_stock_moves; requiere un canonical_account_entries_stock
-- separado, out of scope de esta iteración).
--
-- Validación post-rewrite (live 2026-04-27):
--   dec-25 overhead_mxn (residual_501_01) = $20,669,660.89 (sin cambio)
--   abr-26 overhead_mxn = $7,076,517.14 (sin cambio)
--   Solo cambia revenue_invoices_mxn (cross-check, no entra en residual):
--   dec-25 bronze $17.87M → canonical $18.47M (+3.3% por SAT-only invoices
--   que bronze odoo_invoice_lines no incluía).
--
-- Approach: amount_total_mxn_resolved (con IVA, ya en MXN) × ratio
-- (untaxed_odoo / total_odoo) preserva FX original sin necesidad de
-- amount_untaxed_mxn_resolved (que canonical_invoices no tiene). Filtros
-- NULL-safe estado_sat + state_odoo (consistente con writer ltv_sin_iva).

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
-- CAPA layer: bronze read INTENCIONAL. Requiere semántica journal-entry-level
-- (journal_name='CAPA DE VALORACIÓN', amount_total) que canonical_stock_moves
-- no expone (stock_moves tiene value=cost_per_move, no journal_total).
-- Para silverizar haría falta canonical_account_entries_stock (out of scope).
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
-- Cross-check revenue desde silver canonical_invoices (migrado del bronze
-- odoo_invoice_lines en audit 2026-04-27). amount_total_mxn_resolved con
-- IVA ya en MXN × ratio (untaxed_odoo / total_odoo) da MXN sin IVA con FX
-- original preservado. Filtros NULL-safe estado_sat + state_odoo.
invoices_rev AS (
  SELECT to_char(date_trunc('month', ci.invoice_date_resolved)::date, 'YYYY-MM') AS period,
         COALESCE(SUM(
           ci.amount_total_mxn_resolved
           * CASE WHEN COALESCE(ci.amount_total_odoo, 0) > 0
                  THEN COALESCE(ci.amount_untaxed_odoo, 0) / ci.amount_total_odoo
                  ELSE 0.8621  -- fallback 1/1.16 IVA estándar
             END
         ), 0)::numeric AS revenue_mxn
  FROM public.canonical_invoices ci
  WHERE ci.direction = 'issued'
    AND ci.invoice_date_resolved >= p_date_from
    AND ci.invoice_date_resolved < p_date_to
    AND COALESCE(ci.state_odoo, 'posted') <> 'cancel'
    AND LOWER(COALESCE(ci.estado_sat, 'vigente')) NOT IN ('cancelado', 'c')
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

-- Refresh idempotente del cache para que todos los meses queden con la
-- nueva lógica del cross-check. residual_501_01 (overhead_mxn) NO cambia
-- porque cogs_contable_raw_mxn y cogs_recursive_mp_mxn no se tocaron.
SELECT public.refresh_cogs_monthly_cache('2024-01');
