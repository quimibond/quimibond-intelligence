-- Fix: distribuir AP overdue gradualmente en vez de dumpearlo en week 0.
-- Antes: ALL overdue → +3 days. Después: aging-based spread.
--   0-7d → +3d (0.95 conf), 8-30d → +10d (0.85), 31-60d → +21d (0.70), >60d → +42d (0.50)

CREATE OR REPLACE VIEW cashflow_ap_predicted AS
SELECT
  i.id, i.company_id, i.name, i.invoice_date, i.due_date,
  COALESCE(i.days_overdue, 0) AS days_overdue,
  COALESCE(i.amount_residual_mxn, i.amount_residual, 0)::numeric AS residual_mxn,
  CASE
    WHEN i.due_date IS NULL THEN (CURRENT_DATE + INTERVAL '14 days')::date
    WHEN i.due_date < CURRENT_DATE AND COALESCE(i.days_overdue, 0) <= 7
      THEN (CURRENT_DATE + INTERVAL '3 days')::date
    WHEN i.due_date < CURRENT_DATE AND COALESCE(i.days_overdue, 0) <= 30
      THEN (CURRENT_DATE + INTERVAL '10 days')::date
    WHEN i.due_date < CURRENT_DATE AND COALESCE(i.days_overdue, 0) <= 60
      THEN (CURRENT_DATE + INTERVAL '21 days')::date
    WHEN i.due_date < CURRENT_DATE AND COALESCE(i.days_overdue, 0) > 60
      THEN (CURRENT_DATE + INTERVAL '42 days')::date
    WHEN pp.median_days_to_pay IS NOT NULL AND pp.typical_day_of_month IS NOT NULL THEN
      snap_to_day_of_month(
        GREATEST(CURRENT_DATE, (i.invoice_date + pp.median_days_to_pay::int * INTERVAL '1 day')::date),
        pp.typical_day_of_month)
    ELSE i.due_date
  END::date AS predicted_payment_date,
  CASE
    WHEN i.due_date IS NULL THEN 0.85
    WHEN COALESCE(i.days_overdue, 0) <= 7  THEN 0.95
    WHEN COALESCE(i.days_overdue, 0) <= 30 THEN 0.85
    WHEN COALESCE(i.days_overdue, 0) <= 60 THEN 0.70
    WHEN COALESCE(i.days_overdue, 0) > 60  THEN 0.50
    WHEN pp.confidence IS NOT NULL THEN
      pp.confidence * CASE
        WHEN COALESCE(pp.stddev_days_to_pay, 999) < 10 THEN 0.95
        WHEN COALESCE(pp.stddev_days_to_pay, 999) < 20 THEN 0.85
        ELSE 0.70 END
    ELSE 0.90
  END::numeric AS confidence
FROM odoo_invoices i
LEFT JOIN partner_payment_profile pp
  ON pp.odoo_partner_id = i.odoo_partner_id AND pp.payment_type = 'outbound'
WHERE i.move_type = 'in_invoice'
  AND i.state = 'posted'
  AND i.payment_state IN ('not_paid', 'partial')
  AND COALESCE(i.amount_residual_mxn, i.amount_residual, 0) > 0;
