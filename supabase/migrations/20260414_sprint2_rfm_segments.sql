-- Sprint 2.3 — rfm_segments matview
-- Recency / Frequency / Monetary scoring + clasificación en 8 segmentos.
-- Descubrimiento audit: 21 AT_RISK con 21M MXN revenue 12m — reactivation target.

CREATE MATERIALIZED VIEW IF NOT EXISTS public.rfm_segments AS
WITH base AS (
  SELECT
    i.company_id,
    c.name AS company_name,
    COALESCE(cp.tier, 'minor') AS tier,
    MAX(i.invoice_date) AS last_purchase,
    MIN(i.invoice_date) AS first_purchase,
    (CURRENT_DATE - MAX(i.invoice_date))::int AS recency_days,
    COUNT(*) AS frequency,
    SUM(i.amount_total_mxn)::numeric(20,2) AS monetary_2y,
    SUM(i.amount_total_mxn) FILTER (WHERE i.invoice_date >= CURRENT_DATE - INTERVAL '365 days')::numeric(20,2) AS monetary_12m,
    SUM(i.amount_total_mxn) FILTER (WHERE i.invoice_date >= CURRENT_DATE - INTERVAL '90 days')::numeric(20,2) AS monetary_90d,
    AVG(i.amount_total_mxn)::numeric(20,2) AS avg_ticket,
    SUM(CASE WHEN i.payment_state IN ('not_paid','partial') THEN i.amount_residual_mxn ELSE 0 END)::numeric(20,2) AS outstanding,
    MAX(i.days_overdue) AS max_days_overdue
  FROM odoo_invoices i
  JOIN companies c ON c.id = i.company_id
  LEFT JOIN company_profile cp ON cp.company_id = i.company_id
  WHERE i.move_type = 'out_invoice' AND i.state = 'posted'
    AND i.invoice_date >= CURRENT_DATE - INTERVAL '730 days'
    AND c.is_customer = true
  GROUP BY i.company_id, c.name, cp.tier
),
scored AS (
  SELECT *,
    NTILE(5) OVER (ORDER BY recency_days DESC) AS r_score,
    NTILE(5) OVER (ORDER BY frequency ASC) AS f_score,
    NTILE(5) OVER (ORDER BY monetary_2y ASC) AS m_score
  FROM base
)
SELECT
  company_id, company_name, tier,
  last_purchase, first_purchase, recency_days,
  frequency, monetary_2y, monetary_12m, monetary_90d, avg_ticket,
  outstanding, max_days_overdue,
  r_score, f_score, m_score,
  (r_score * 100 + f_score * 10 + m_score) AS rfm_code,
  CASE
    WHEN recency_days <= 60  AND frequency >= 12 AND monetary_12m >= 1000000 THEN 'CHAMPIONS'
    WHEN recency_days <= 90  AND frequency >= 6  AND r_score >= 4 THEN 'LOYAL'
    WHEN recency_days <= 90  AND frequency <= 3  AND first_purchase >= CURRENT_DATE - INTERVAL '180 days' THEN 'NEW'
    WHEN recency_days BETWEEN 91 AND 180 AND frequency >= 6 THEN 'AT_RISK'
    WHEN recency_days BETWEEN 91 AND 180 THEN 'NEED_ATTENTION'
    WHEN recency_days BETWEEN 181 AND 365 THEN 'HIBERNATING'
    WHEN recency_days > 365 THEN 'LOST'
    ELSE 'OCCASIONAL'
  END AS segment,
  LEAST(100, GREATEST(0,
    CASE
      WHEN recency_days BETWEEN 91 AND 180 AND frequency >= 6
        THEN 80 + LEAST(20, (monetary_12m/500000)::int)
      WHEN recency_days BETWEEN 91 AND 180
        THEN 50 + LEAST(20, (monetary_12m/500000)::int)
      WHEN recency_days <= 60 AND frequency >= 12
        THEN 30
      WHEN recency_days BETWEEN 181 AND 365 AND monetary_12m > 200000
        THEN 60
      ELSE 10
    END
  ))::int AS contact_priority_score,
  NOW() AS computed_at
FROM scored;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rfm_segments_pk ON public.rfm_segments (company_id);
CREATE INDEX IF NOT EXISTS idx_rfm_segments_segment ON public.rfm_segments (segment);
CREATE INDEX IF NOT EXISTS idx_rfm_segments_priority ON public.rfm_segments (contact_priority_score DESC);

COMMENT ON MATERIALIZED VIEW public.rfm_segments IS
'RFM segmentation de clientes 2y. 8 segmentos + contact_priority_score 0-100 para reactivación dirigida.';

CREATE OR REPLACE FUNCTION public.refresh_rfm_segments()
RETURNS void LANGUAGE sql AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.rfm_segments;
$$;
