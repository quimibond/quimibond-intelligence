-- Sprint 2.2 — Collection Effectiveness Index (CEI)
-- Métrica de tesorería: % del facturado cobrado por cohort mensual.
-- Detecta degradación de cobranza antes que llegue al aging bucket.

CREATE OR REPLACE VIEW public.collection_effectiveness_index AS
WITH monthly AS (
  SELECT
    DATE_TRUNC('month', invoice_date)::date AS cohort_month,
    COUNT(*) AS invoices_issued,
    COUNT(DISTINCT company_id) AS customers,
    SUM(amount_total_mxn) AS billed_mxn,
    SUM(CASE WHEN payment_state='paid' THEN amount_total_mxn ELSE 0 END) AS collected_mxn,
    SUM(amount_residual_mxn) AS outstanding_mxn,
    SUM(CASE WHEN payment_state IN ('not_paid','partial') AND days_overdue > 30
             THEN amount_residual_mxn ELSE 0 END) AS overdue_30d_mxn,
    SUM(CASE WHEN payment_state IN ('not_paid','partial') AND days_overdue > 90
             THEN amount_residual_mxn ELSE 0 END) AS overdue_90d_mxn,
    AVG(days_to_pay) FILTER (WHERE payment_state='paid' AND days_to_pay IS NOT NULL) AS avg_days_to_pay
  FROM odoo_invoices
  WHERE move_type = 'out_invoice' AND state = 'posted'
    AND invoice_date >= CURRENT_DATE - INTERVAL '24 months'
  GROUP BY 1
)
SELECT
  cohort_month,
  (EXTRACT(MONTH FROM AGE(CURRENT_DATE, cohort_month))::int
    + EXTRACT(YEAR  FROM AGE(CURRENT_DATE, cohort_month))::int * 12) AS cohort_age_months,
  invoices_issued,
  customers,
  billed_mxn::numeric(20,2),
  collected_mxn::numeric(20,2),
  outstanding_mxn::numeric(20,2),
  overdue_30d_mxn::numeric(20,2),
  overdue_90d_mxn::numeric(20,2),
  ROUND((collected_mxn / NULLIF(billed_mxn,0) * 100)::numeric, 2) AS cei_pct,
  ROUND((overdue_90d_mxn / NULLIF(billed_mxn,0) * 100)::numeric, 2) AS leakage_90d_pct,
  ROUND(avg_days_to_pay::numeric, 1) AS avg_days_to_pay,
  CASE
    WHEN (EXTRACT(MONTH FROM AGE(CURRENT_DATE, cohort_month))::int
          + EXTRACT(YEAR  FROM AGE(CURRENT_DATE, cohort_month))::int * 12) < 2
      THEN 'too_recent'
    WHEN (collected_mxn / NULLIF(billed_mxn,0)) >= 0.95 THEN 'healthy'
    WHEN (collected_mxn / NULLIF(billed_mxn,0)) >= 0.85 THEN 'watch'
    WHEN (collected_mxn / NULLIF(billed_mxn,0)) >= 0.70 THEN 'at_risk'
    ELSE 'degraded'
  END AS health_status,
  ROUND(((collected_mxn/NULLIF(billed_mxn,0)) -
         LAG(collected_mxn/NULLIF(billed_mxn,0)) OVER (ORDER BY cohort_month))::numeric * 100, 2) AS cei_delta_vs_prev
FROM monthly
ORDER BY cohort_month DESC;

COMMENT ON VIEW public.collection_effectiveness_index IS
'Collection Effectiveness Index (CEI) por cohort mensual. CEI = collected/billed. Health: healthy >=95%, watch 85-95%, at_risk 70-85%, degraded <70%.';
