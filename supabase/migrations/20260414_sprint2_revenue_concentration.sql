-- Sprint 2.6 — revenue_concentration view
-- Rank + Pareto + tripwires para los top customers (top 5 = 58% del revenue).

CREATE OR REPLACE VIEW public.revenue_concentration AS
WITH rev_12m AS (
  SELECT
    i.company_id,
    c.name AS company_name,
    COALESCE(cp.tier,'minor') AS tier,
    SUM(i.amount_total_mxn) AS rev_12m,
    SUM(i.amount_total_mxn) FILTER (WHERE i.invoice_date >= CURRENT_DATE - INTERVAL '30 days') AS rev_30d,
    SUM(i.amount_total_mxn) FILTER (WHERE i.invoice_date >= CURRENT_DATE - INTERVAL '60 days' AND i.invoice_date < CURRENT_DATE - INTERVAL '30 days') AS rev_30d_prev,
    SUM(i.amount_total_mxn) FILTER (WHERE i.invoice_date >= CURRENT_DATE - INTERVAL '90 days') AS rev_90d,
    MAX(i.invoice_date) AS last_invoice_date
  FROM odoo_invoices i
  JOIN companies c ON c.id = i.company_id
  LEFT JOIN company_profile cp ON cp.company_id = i.company_id
  WHERE i.move_type='out_invoice' AND i.state='posted'
    AND i.invoice_date >= CURRENT_DATE - INTERVAL '365 days'
  GROUP BY i.company_id, c.name, cp.tier
  HAVING SUM(i.amount_total_mxn) > 0
),
ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (ORDER BY rev_12m DESC) AS rank_in_portfolio,
    rev_12m / NULLIF(SUM(rev_12m) OVER (),0) AS share_pct,
    SUM(rev_12m) OVER (ORDER BY rev_12m DESC) / NULLIF(SUM(rev_12m) OVER (),0) AS cumulative_pct
  FROM rev_12m
)
SELECT
  company_id, company_name, tier, rank_in_portfolio,
  rev_12m::numeric(20,2), rev_90d::numeric(20,2),
  rev_30d::numeric(20,2), rev_30d_prev::numeric(20,2),
  ROUND((share_pct * 100)::numeric, 2) AS share_pct,
  ROUND((cumulative_pct * 100)::numeric, 2) AS cumulative_pct,
  CASE
    WHEN cumulative_pct <= 0.80 THEN 'A'
    WHEN cumulative_pct <= 0.95 THEN 'B'
    ELSE 'C'
  END AS pareto_class,
  last_invoice_date,
  (CURRENT_DATE - last_invoice_date)::int AS days_since_last_invoice,
  ROUND(((rev_30d - COALESCE(rev_30d_prev,0)) / NULLIF(rev_30d_prev,0) * 100)::numeric, 1) AS rev_30d_delta_pct,
  CASE
    WHEN rank_in_portfolio <= 5 AND rev_30d_prev > 0
      AND (rev_30d - rev_30d_prev)/rev_30d_prev < -0.25
      THEN 'TOP5_DECLINE_25PCT'
    WHEN rank_in_portfolio <= 10 AND rev_30d_prev > 0
      AND (rev_30d - rev_30d_prev)/rev_30d_prev < -0.40
      THEN 'TOP10_DECLINE_40PCT'
    WHEN rank_in_portfolio <= 5 AND (CURRENT_DATE - last_invoice_date) > 45
      THEN 'TOP5_NO_ORDER_45D'
    ELSE NULL
  END AS tripwire
FROM ranked
ORDER BY rank_in_portfolio;

COMMENT ON VIEW public.revenue_concentration IS
'Concentración de revenue 12m con rank + Pareto class + tripwires (TOP5_DECLINE_25PCT, TOP10_DECLINE_40PCT, TOP5_NO_ORDER_45D).';
