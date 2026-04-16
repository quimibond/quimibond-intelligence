-- ═══════════════════════════════════════════════════════════════
-- Cashflow v3 · Profile-driven predictions
-- ═══════════════════════════════════════════════════════════════
-- Mejora in-place las 5 views que alimentan projected_cash_flow_weekly:
--   1. cashflow_ar_predicted — partner_payment_profile para timing real
--   2. cashflow_ap_predicted — nuestro comportamiento real de pago
--   3. cashflow_payroll_monthly — desde account_payment_profile
--   4. cashflow_opex_monthly   — desde account_payment_profile
--   5. cashflow_tax_monthly    — desde account_payment_profile
--
-- + helper function snap_to_day_of_month()
-- + cashflow_recurring_detail (nueva, drill-down por categoría)
--
-- projected_cash_flow_weekly NO se toca — consume las mismas views
-- con la misma interfaz y se beneficia automáticamente.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION snap_to_day_of_month(base_date date, target_day int)
RETURNS date
LANGUAGE sql IMMUTABLE STRICT
AS $$
  SELECT CASE
    WHEN target_day IS NULL THEN base_date
    WHEN EXTRACT(DAY FROM base_date)::int <= target_day THEN
      LEAST(
        (date_trunc('month', base_date) + (target_day - 1) * INTERVAL '1 day')::date,
        (date_trunc('month', base_date) + INTERVAL '1 month - 1 day')::date
      )
    ELSE
      LEAST(
        (date_trunc('month', base_date) + INTERVAL '1 month' + (target_day - 1) * INTERVAL '1 day')::date,
        (date_trunc('month', base_date) + INTERVAL '2 months - 1 day')::date
      )
  END
$$;

-- ─── cashflow_ar_predicted (v3) ──────────────────────────────
CREATE OR REPLACE VIEW cashflow_ar_predicted AS
WITH open_ar AS (
  SELECT
    i.id, i.company_id, i.odoo_partner_id, i.name,
    i.invoice_date, i.due_date,
    COALESCE(i.days_overdue, 0) AS days_overdue,
    COALESCE(i.amount_residual_mxn, i.amount_residual, 0)::numeric AS residual_mxn
  FROM odoo_invoices i
  WHERE i.move_type = 'out_invoice'
    AND i.state = 'posted'
    AND i.payment_state IN ('not_paid', 'partial')
    AND COALESCE(i.amount_residual_mxn, i.amount_residual, 0) > 0
)
SELECT
  o.id, o.company_id, o.name, o.invoice_date, o.due_date,
  o.days_overdue, o.residual_mxn,
  CASE
    WHEN o.days_overdue > 60 THEN (CURRENT_DATE + INTERVAL '21 days')::date
    WHEN o.days_overdue > 0  THEN (CURRENT_DATE + INTERVAL '7 days')::date
    WHEN pp.median_days_to_pay IS NOT NULL THEN
      snap_to_day_of_month(
        GREATEST(CURRENT_DATE, (o.invoice_date + pp.median_days_to_pay::int * INTERVAL '1 day')::date),
        pp.typical_day_of_month
      )
    WHEN b.avg_days IS NOT NULL THEN
      GREATEST(CURRENT_DATE, (o.invoice_date + (LEAST(b.avg_days, 180))::int * INTERVAL '1 day')::date)
    ELSE GREATEST(CURRENT_DATE, (o.invoice_date + INTERVAL '39 days')::date)
  END::date AS predicted_payment_date,
  CASE
    WHEN o.days_overdue > 60 THEN
      GREATEST(0.15, 0.35 - COALESCE(pp.writeoff_risk_pct, 0) / 100.0 * 0.20)
    WHEN o.days_overdue > 0 THEN 0.55
    WHEN pp.confidence IS NOT NULL THEN
      pp.confidence * CASE
        WHEN COALESCE(pp.stddev_days_to_pay, 999) < 10 THEN 0.95
        WHEN COALESCE(pp.stddev_days_to_pay, 999) < 20 THEN 0.85
        WHEN COALESCE(pp.stddev_days_to_pay, 999) < 40 THEN 0.70
        ELSE 0.55
      END
    WHEN b.confidence IS NOT NULL THEN b.confidence
    ELSE 0.45
  END::numeric AS confidence,
  CASE
    WHEN o.days_overdue > 60 THEN 'overdue_deep'
    WHEN o.days_overdue > 0  THEN 'overdue_recent'
    WHEN pp.median_days_to_pay IS NOT NULL THEN 'partner_profile'
    WHEN b.source IS NOT NULL THEN b.source
    ELSE 'global_fallback'
  END AS source
FROM open_ar o
LEFT JOIN partner_payment_profile pp
  ON  pp.odoo_partner_id = o.odoo_partner_id AND pp.payment_type = 'inbound'
LEFT JOIN cashflow_company_behavior b
  ON  b.company_id = o.company_id;

-- ─── cashflow_ap_predicted (v3) ──────────────────────────────
CREATE OR REPLACE VIEW cashflow_ap_predicted AS
SELECT
  i.id, i.company_id, i.name, i.invoice_date, i.due_date,
  COALESCE(i.days_overdue, 0) AS days_overdue,
  COALESCE(i.amount_residual_mxn, i.amount_residual, 0)::numeric AS residual_mxn,
  CASE
    WHEN i.due_date IS NULL THEN (CURRENT_DATE + INTERVAL '14 days')::date
    WHEN i.due_date < CURRENT_DATE THEN (CURRENT_DATE + INTERVAL '3 days')::date
    WHEN pp.median_days_to_pay IS NOT NULL AND pp.typical_day_of_month IS NOT NULL THEN
      snap_to_day_of_month(
        GREATEST(CURRENT_DATE, (i.invoice_date + pp.median_days_to_pay::int * INTERVAL '1 day')::date),
        pp.typical_day_of_month
      )
    ELSE i.due_date
  END::date AS predicted_payment_date,
  CASE
    WHEN i.due_date < CURRENT_DATE THEN 0.95
    WHEN pp.confidence IS NOT NULL THEN
      pp.confidence * CASE
        WHEN COALESCE(pp.stddev_days_to_pay, 999) < 10 THEN 0.95
        WHEN COALESCE(pp.stddev_days_to_pay, 999) < 20 THEN 0.85
        ELSE 0.70
      END
    ELSE 0.90
  END::numeric AS confidence
FROM odoo_invoices i
LEFT JOIN partner_payment_profile pp
  ON  pp.odoo_partner_id = i.odoo_partner_id AND pp.payment_type = 'outbound'
WHERE i.move_type = 'in_invoice'
  AND i.state = 'posted'
  AND i.payment_state IN ('not_paid', 'partial')
  AND COALESCE(i.amount_residual_mxn, i.amount_residual, 0) > 0;

-- ─── cashflow_payroll_monthly (v3) ───────────────────────────
CREATE OR REPLACE VIEW cashflow_payroll_monthly AS
SELECT
  COALESCE(SUM(avg_monthly_net) FILTER (
    WHERE detected_category = 'payroll_regular' AND frequency IN ('monthly','irregular_monthly')
  ), 0)::numeric AS monthly_mxn,
  COUNT(*) FILTER (
    WHERE detected_category = 'payroll_regular' AND frequency = 'monthly'
  )::int AS months_used,
  'account_payment_profile'::text AS periods
FROM account_payment_profile;

-- ─── cashflow_opex_monthly (v3) ──────────────────────────────
CREATE OR REPLACE VIEW cashflow_opex_monthly AS
SELECT
  COALESCE(SUM(avg_monthly_net) FILTER (
    WHERE detected_category = 'opex_recurring' AND frequency IN ('monthly','irregular_monthly')
  ), 0)::numeric AS monthly_mxn,
  COUNT(*) FILTER (
    WHERE detected_category = 'opex_recurring' AND frequency = 'monthly'
  )::int AS months_used,
  'account_payment_profile'::text AS periods
FROM account_payment_profile;

-- ─── cashflow_tax_monthly (v3) ───────────────────────────────
CREATE OR REPLACE VIEW cashflow_tax_monthly AS
SELECT
  GREATEST(COALESCE(SUM(avg_monthly_net) FILTER (
    WHERE detected_category LIKE 'tax_%' AND frequency IN ('monthly','irregular_monthly')
  ), 0), 0)::numeric AS monthly_mxn,
  COUNT(*) FILTER (
    WHERE detected_category LIKE 'tax_%' AND frequency = 'monthly'
  )::int AS months_used
FROM account_payment_profile;

-- ─── cashflow_recurring_detail (nueva) ───────────────────────
CREATE OR REPLACE VIEW cashflow_recurring_detail AS
SELECT
  detected_category,
  COUNT(*) AS account_count,
  COUNT(*) FILTER (WHERE frequency = 'monthly') AS monthly_count,
  ROUND(SUM(avg_monthly_net)::numeric, 2)       AS total_monthly_net,
  ROUND(SUM(median_monthly_net)::numeric, 2)    AS total_median_net,
  ROUND(SUM(stddev_monthly_net)::numeric, 2)    AS total_stddev,
  ROUND(AVG(confidence)::numeric, 3)            AS avg_confidence
FROM account_payment_profile
WHERE frequency IN ('monthly', 'irregular_monthly')
GROUP BY detected_category
ORDER BY ABS(SUM(avg_monthly_net)) DESC;
