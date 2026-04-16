-- ============================================================================
-- Migration 20260416: Fix burn_rate_weekly formula
--
-- Audit 2026-04-16: cashflow_liquidity_metrics.burn_rate_weekly subestima la
-- nómina en ~50% porque la conversión de quincenal → semanal tiene un /2.0
-- de más.
--
--   ANTES: burn = (payroll_quincenal / 2.0) * (7.0/15.0) + opex_w + tax_w
--                 = 211,175 + 633,961 + 222,595 = 1,067,732 MXN/sem
--
--   CORRECTO: burn = payroll_quincenal * (7.0/15.0) + opex_w + tax_w
--                 = 422,351 + 633,961 + 222,595 = 1,278,907 MXN/sem
--
-- Con el fix runway_weeks_recurring_only baja de 3.4 a ~2.86 semanas
-- (porque el burn es ~20% mayor) — más realista.
--
-- Razonamiento: payroll_quincenal ya es el pago biweekly (cada 15 días).
-- Equivalente semanal = quincenal * (7/15). El /2.0 adicional estaba
-- tratándolo como mensual.
-- ============================================================================

CREATE OR REPLACE VIEW cashflow_liquidity_metrics AS
WITH
  cash AS (SELECT cash_net_mxn FROM cashflow_current_cash),
  transit AS (SELECT in_transit_mxn FROM cashflow_in_transit),
  effective AS (
    SELECT (cash.cash_net_mxn + transit.in_transit_mxn)::numeric AS effective_mxn
    FROM cash, transit
  ),
  overdue_ar AS (
    SELECT COALESCE(SUM(residual_mxn), 0)::numeric AS ar_overdue
    FROM cashflow_ar_predicted WHERE days_overdue > 0
  ),
  overdue_ap AS (
    SELECT COALESCE(SUM(residual_mxn), 0)::numeric AS ap_overdue
    FROM cashflow_ap_predicted WHERE days_overdue > 0
  ),
  recurring AS (
    SELECT
      (SELECT monthly_mxn FROM cashflow_payroll_monthly) / 2.0 AS payroll_quincenal,
      (SELECT monthly_mxn FROM cashflow_opex_monthly) / 4.3333 AS opex_weekly,
      (SELECT monthly_mxn FROM cashflow_tax_monthly) / 4.3333  AS tax_weekly
  ),
  burn AS (
    -- Nómina: payroll_quincenal es el monto biweekly (cada 15 días).
    -- Equivalente semanal = quincenal × 7/15. El factor anterior /2.0 era
    -- un bug que subestimaba la carga laboral por mitad.
    SELECT (r.payroll_quincenal * 7.0/15.0 + r.opex_weekly + r.tax_weekly)::numeric
           AS burn_rate_weekly
    FROM recurring r
  )
SELECT
  e.effective_mxn,
  oar.ar_overdue,
  oap.ap_overdue,
  (e.effective_mxn - oap.ap_overdue)::numeric AS liquidity_gap_if_pay_all_overdue,
  CASE WHEN oap.ap_overdue > 0
    THEN ROUND((e.effective_mxn / oap.ap_overdue * 100)::numeric, 1)
    ELSE 100.0
  END AS ap_overdue_coverage_ratio,
  CASE WHEN b.burn_rate_weekly > 0
    THEN ROUND((e.effective_mxn / b.burn_rate_weekly)::numeric, 1)
    ELSE 52.0
  END AS runway_weeks_recurring_only,
  ROUND(b.burn_rate_weekly::numeric, 2) AS burn_rate_weekly,
  ROUND(r.payroll_quincenal::numeric, 2) AS payroll_quincenal,
  ROUND(r.opex_weekly::numeric, 2) AS opex_weekly,
  ROUND(r.tax_weekly::numeric, 2) AS tax_weekly
FROM effective e, overdue_ar oar, overdue_ap oap, recurring r, burn b;

COMMENT ON VIEW cashflow_liquidity_metrics IS
  'Métricas de liquidez para get_cashflow_recommendations. burn_rate_weekly = payroll_quincenal*7/15 + opex_weekly + tax_weekly. ap_overdue_coverage_ratio expresado en PORCENTAJE (0-100+), NO en ratio 0-1.';

NOTIFY pgrst, 'reload schema';
