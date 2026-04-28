-- cogs_monthly_cache v3: filtro is_quimibond_relevant en cross-check de revenue
--
-- Problema detectado 2026-04-28: el cross-check `revenue_invoices_mxn`
-- mostraba $189.24M para 2025 vs P&L contable $174.97M (delta +$14.27M).
-- La descomposición:
--   $7,141,100  CFDIs no-relevantes a Quimibond (Syntage extrae CFDIs externos
--               como las 17 facturas $558,448/mes Jose Mizrahi → Entretelas
--               Brinco que NO involucran a Quimibond pero entran al SAT
--               extraction porque comparten algún taxpayer link)
--   $7,151,519  Ventas extraordinarias 704.23 (venta activo fijo + otros)
--               legítimamente facturadas por Quimibond pero contablemente
--               viven en 7xx, no 4xx. PnlNormalizedCard ya las separa.
--      $65,752  SAT-only Quimibond-relevant (sync gap real)
--     -$85,222  Residual (ruido)
--
-- Fix: agregar `AND COALESCE(ci.is_quimibond_relevant, true) = true` en el
-- CTE invoices_rev. Esto descarta el $7.14M de CFDIs externos sin afectar
-- residual_501_01 (cogs_contable_raw + cogs_recursive_mp no se tocan).
--
-- Validación post-fix (2026-04-28 02:30 UTC):
--   revenue_invoices_mxn 2025: $189.24M → $182.10M
--   delta vs revenue_4xx:        +$14.27M → +$7.13M (= solo 704.23, esperado)
--   overhead_mxn 2025-12:    $20,669,660 → $20,669,445 (~ruido recompute)
--
-- IMPORTANTE: el filtro is_quimibond_relevant=true ya estaba en pnl.ts y
-- todas las queries cobranza (5+ archivos), pero faltaba en cogs cache.
-- Sin él, el cross-check informa cifra inflada.

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
-- CAPA layer: bronze read INTENCIONAL (semántica journal-entry-level no
-- existe en canonical_stock_moves; requiere canonical_account_entries_stock).
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
-- Cross-check revenue desde silver canonical_invoices.
-- v3 (2026-04-28): filtra is_quimibond_relevant=true para excluir CFDIs
-- externos que Syntage extrae pero no son operativos de Quimibond.
invoices_rev AS (
  SELECT to_char(date_trunc('month', ci.invoice_date_resolved)::date, 'YYYY-MM') AS period,
         COALESCE(SUM(
           ci.amount_total_mxn_resolved
           * CASE WHEN COALESCE(ci.amount_total_odoo, 0) > 0
                  THEN COALESCE(ci.amount_untaxed_odoo, 0) / ci.amount_total_odoo
                  ELSE 0.8621
             END
         ), 0)::numeric AS revenue_mxn
  FROM public.canonical_invoices ci
  WHERE ci.direction = 'issued'
    AND ci.invoice_date_resolved >= p_date_from
    AND ci.invoice_date_resolved < p_date_to
    AND COALESCE(ci.is_quimibond_relevant, true) = true
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

SELECT public.refresh_cogs_monthly_cache('2024-01');
