-- Reorg R1.3: Vista master analytics_customer_360
-- Joinea company_profile (comercial) + customer_ltv_health (LTV) + company_narrative
-- (AI facts) + analytics_customer_fiscal_lifetime (fiscal SAT) + reconciliation_issues.
-- Es la ÚNICA fuente de verdad para perfil 360 de empresa.

CREATE OR REPLACE VIEW public.analytics_customer_360 AS
SELECT
  cp.company_id, cp.name, cp.canonical_name, cp.is_customer, cp.is_supplier,
  cp.industry, cp.tier, cp.risk_level,
  cp.credit_limit, cp.total_revenue AS revenue_lifetime_mxn, cp.total_orders,
  cp.last_order_date, cp.revenue_90d, cp.revenue_prior_90d,
  cp.trend_pct AS revenue_trend_90d_pct, cp.revenue_share_pct,
  cp.pending_amount, cp.overdue_amount, cp.overdue_count, cp.overdue_30d_count,
  cp.max_days_overdue,
  cp.total_deliveries, cp.late_deliveries, cp.otd_rate,
  cp.total_purchases, cp.last_purchase_date,
  cp.email_count, cp.last_email_date, cp.contact_count,
  ltv.ltv_mxn, ltv.revenue_12m AS revenue_12m_mxn, ltv.revenue_3m AS revenue_3m_mxn,
  ltv.trend_pct_vs_prior_quarters AS trend_pct_yoy,
  ltv.first_purchase, ltv.last_purchase,
  ltv.churn_risk_score, ltv.overdue_risk_score, ltv.days_since_last_order,
  cn.salespeople, cn.top_products,
  cn.complaints AS complaints_total, cn.recent_complaints,
  cn.commitments, cn.requests, cn.emails_30d, cn.risk_signal,
  fcl.lifetime_revenue_mxn AS fiscal_lifetime_revenue_mxn,
  fcl.revenue_12m_mxn AS fiscal_revenue_12m_mxn,
  fcl.yoy_pct AS fiscal_yoy_pct,
  fcl.cancellation_rate_pct AS fiscal_cancellation_rate_pct,
  fcl.days_since_last_cfdi AS fiscal_days_since_last_cfdi,
  fcl.first_cfdi AS fiscal_first_cfdi,
  ccr.cancelados_24m AS fiscal_cancelled_24m,
  ccr.cancelled_amount_mxn AS fiscal_cancelled_amount_mxn,
  (SELECT count(*) FROM public.reconciliation_issues ri
   WHERE ri.company_id = cp.company_id AND ri.resolved_at IS NULL) AS fiscal_issues_open,
  (SELECT count(*) FROM public.reconciliation_issues ri
   WHERE ri.company_id = cp.company_id AND ri.resolved_at IS NULL
     AND ri.severity = 'critical') AS fiscal_issues_critical
FROM public.company_profile cp
LEFT JOIN public.customer_ltv_health ltv ON ltv.company_id = cp.company_id
LEFT JOIN public.company_narrative cn ON cn.company_id = cp.company_id
LEFT JOIN public.companies c ON c.id = cp.company_id
LEFT JOIN public.analytics_customer_fiscal_lifetime fcl ON lower(fcl.rfc) = lower(c.rfc)
LEFT JOIN public.analytics_customer_cancellation_rates ccr ON lower(ccr.rfc) = lower(c.rfc);

GRANT SELECT ON public.analytics_customer_360 TO service_role, authenticated;

COMMENT ON VIEW public.analytics_customer_360 IS
  'Master 360 view per empresa. source=hybrid (odoo company_profile + customer_ltv_health + company_narrative + syntage fiscal). Coverage: 2021+ operativo / 2014+ fiscal. Preferir esta sobre las 3 fuentes.';
