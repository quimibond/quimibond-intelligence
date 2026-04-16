-- Recrear cashflow_liquidity_metrics (se perdió en una sesión anterior).
-- Requerida por get_cashflow_recommendations() RPC.

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
    SELECT (r.payroll_quincenal / 2.0 * 7.0/15.0 + r.opex_weekly + r.tax_weekly)::numeric AS burn_rate_weekly
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
