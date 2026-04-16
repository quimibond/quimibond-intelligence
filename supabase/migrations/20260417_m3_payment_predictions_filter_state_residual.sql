-- M3 — payment_predictions: filtrar state=posted AND amount_residual>0
-- Audit 2026-04-16. Aplicada en prod via MCP.
-- El LATERAL subquery sumaba invoices sin filtrar por state ni
-- amount_residual>0 → 2 companies divergían $1.19M de cash_flow_aging.
-- Post-fix: divergencia residual $4,640 (credit notes pending).
--
-- DROP CASCADE elimina cashflow_company_behavior (view dependent);
-- se recrea con la misma def al final.

DROP MATERIALIZED VIEW IF EXISTS payment_predictions CASCADE;

CREATE MATERIALIZED VIEW payment_predictions AS
WITH payment_history AS (
  SELECT i.company_id,
    i.days_to_pay,
    i.invoice_date,
    i.amount_total
  FROM odoo_invoices i
  WHERE i.move_type = 'out_invoice'::text
    AND i.payment_state = 'paid'::text
    AND i.days_to_pay > 0
    AND i.company_id IS NOT NULL
), company_patterns AS (
  SELECT company_id,
    count(*) AS paid_invoices,
    round(avg(days_to_pay), 0) AS avg_days_to_pay,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY days_to_pay::double precision)::numeric, 0) AS median_days_to_pay,
    round(stddev(days_to_pay), 0) AS stddev_days,
    min(days_to_pay) AS fastest_payment,
    max(days_to_pay) AS slowest_payment,
    round(avg(days_to_pay) FILTER (WHERE invoice_date >= (CURRENT_DATE - 180)), 0) AS avg_recent_6m,
    round(avg(days_to_pay) FILTER (WHERE invoice_date < (CURRENT_DATE - 180)), 0) AS avg_older
  FROM payment_history
  GROUP BY company_id
  HAVING count(*) >= 3
)
SELECT cp.company_id,
  c.canonical_name AS company_name,
  cp2.tier,
  cp.paid_invoices,
  cp.avg_days_to_pay,
  cp.median_days_to_pay,
  cp.stddev_days,
  cp.fastest_payment,
  cp.slowest_payment,
  CASE
    WHEN cp.avg_recent_6m IS NOT NULL AND cp.avg_older IS NOT NULL AND cp.avg_recent_6m > (cp.avg_older + 10) THEN 'deteriorando'
    WHEN cp.avg_recent_6m IS NOT NULL AND cp.avg_older IS NOT NULL AND cp.avg_recent_6m < (cp.avg_older - 10) THEN 'mejorando'
    ELSE 'estable'
  END AS payment_trend,
  cp.avg_recent_6m,
  cp.avg_older,
  pending.pending_count,
  pending.total_pending,
  pending.oldest_due_date,
  pending.max_days_overdue,
  pending.oldest_due_date + ((cp.median_days_to_pay || ' days')::interval) AS predicted_payment_date,
  CASE
    WHEN pending.max_days_overdue > cp.slowest_payment THEN 'CRITICO: excede maximo historico'
    WHEN pending.max_days_overdue::numeric > (cp.avg_days_to_pay + cp.stddev_days * 2) THEN 'ALTO: fuera de patron normal'
    WHEN pending.max_days_overdue::numeric > cp.avg_days_to_pay THEN 'MEDIO: pasado de promedio'
    ELSE 'NORMAL: dentro de patron'
  END AS payment_risk
FROM company_patterns cp
JOIN companies c ON c.id = cp.company_id
LEFT JOIN company_profile cp2 ON cp2.company_id = cp.company_id
LEFT JOIN LATERAL (
  SELECT count(*) AS pending_count,
    sum(COALESCE(i2.amount_residual_mxn, i2.amount_residual)) AS total_pending,
    min(i2.due_date) AS oldest_due_date,
    max(i2.days_overdue) AS max_days_overdue
  FROM odoo_invoices i2
  WHERE i2.company_id = cp.company_id
    AND i2.move_type = 'out_invoice'
    AND (i2.payment_state = ANY (ARRAY['not_paid','partial']))
    -- M3 fix: solo posted con residual real (excluye draft/cancelled/credit-notes-negativas)
    AND i2.state = 'posted'
    AND i2.amount_residual > 0
) pending ON true
WHERE pending.pending_count > 0;

CREATE UNIQUE INDEX idx_payment_predictions_pk ON payment_predictions (company_id);

-- Recrear cashflow_company_behavior (dependent, eliminado por CASCADE)
CREATE OR REPLACE VIEW cashflow_company_behavior AS
WITH from_matview AS (
  SELECT pp.company_id,
    pp.avg_days_to_pay AS avg_days,
    pp.median_days_to_pay AS median_days,
    pp.stddev_days,
    CASE
      WHEN pp.stddev_days IS NULL OR pp.stddev_days = 0 THEN 0.85
      WHEN pp.stddev_days < 15 THEN 0.85
      WHEN pp.stddev_days < 30 THEN 0.75
      WHEN pp.stddev_days < 60 THEN 0.60
      ELSE 0.45
    END AS confidence,
    pp.paid_invoices::integer AS sample_size,
    'matview'::text AS source
  FROM payment_predictions pp
), from_invoices AS (
  SELECT i.company_id,
    avg(i.days_to_pay) AS avg_days,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY i.days_to_pay::double precision)::numeric AS median_days,
    COALESCE(stddev_pop(i.days_to_pay), 0) AS stddev_days,
    CASE
      WHEN count(*) < 3 THEN 0.40
      WHEN COALESCE(stddev_pop(i.days_to_pay), 0) < 15 THEN 0.75
      WHEN COALESCE(stddev_pop(i.days_to_pay), 0) < 30 THEN 0.65
      ELSE 0.50
    END AS confidence,
    count(*)::integer AS sample_size,
    'invoices'::text AS source
  FROM odoo_invoices i
  WHERE i.move_type = 'out_invoice'
    AND i.payment_state = 'paid'
    AND i.days_to_pay IS NOT NULL
    AND i.company_id IS NOT NULL
    AND i.invoice_date >= (CURRENT_DATE - INTERVAL '18 months')
  GROUP BY i.company_id
  HAVING count(*) >= 1
)
SELECT COALESCE(m.company_id, f.company_id) AS company_id,
  COALESCE(m.avg_days, f.avg_days) AS avg_days,
  COALESCE(m.median_days, f.median_days) AS median_days,
  COALESCE(m.stddev_days, f.stddev_days) AS stddev_days,
  COALESCE(m.confidence, f.confidence) AS confidence,
  COALESCE(m.sample_size, f.sample_size) AS sample_size,
  COALESCE(m.source, f.source) AS source
FROM from_matview m
FULL JOIN from_invoices f USING (company_id);
