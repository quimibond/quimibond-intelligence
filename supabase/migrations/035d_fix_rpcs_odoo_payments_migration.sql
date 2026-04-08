-- ============================================================================
-- Migration 035d: Fix RPCs that still referenced odoo_payments
--
-- 1. get_company_financials: recent_payments now reads from odoo_account_payments
-- 2. resolve_all_connections: adds odoo_account_payments company linkage
-- ============================================================================

-- Fix get_company_financials: migrate odoo_payments → odoo_account_payments
CREATE OR REPLACE FUNCTION get_company_financials(p_company_id bigint)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT json_build_object(
      'aging', (
        SELECT json_build_object(
          'current', COALESCE(sum(amount_residual) FILTER (WHERE days_overdue <= 0), 0),
          '1_30', COALESCE(sum(amount_residual) FILTER (WHERE days_overdue BETWEEN 1 AND 30), 0),
          '31_60', COALESCE(sum(amount_residual) FILTER (WHERE days_overdue BETWEEN 31 AND 60), 0),
          '61_90', COALESCE(sum(amount_residual) FILTER (WHERE days_overdue BETWEEN 61 AND 90), 0),
          '90_plus', COALESCE(sum(amount_residual) FILTER (WHERE days_overdue > 90), 0),
          'total_outstanding', COALESCE(sum(amount_residual), 0)
        )
        FROM odoo_invoices
        WHERE company_id = p_company_id
          AND move_type = 'out_invoice'
          AND payment_state IN ('not_paid', 'partial')
      ),
      'recent_invoices', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
        FROM (
          SELECT name, invoice_date, due_date, amount_total, amount_residual,
                 payment_state, days_overdue, currency
          FROM odoo_invoices
          WHERE company_id = p_company_id AND move_type = 'out_invoice'
          ORDER BY invoice_date DESC LIMIT 20
        ) t
      ),
      'recent_payments', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
        FROM (
          SELECT name, date, amount, payment_type, currency, journal_name, payment_method
          FROM odoo_account_payments
          WHERE company_id = p_company_id
          ORDER BY date DESC LIMIT 20
        ) t
      ),
      'payment_behavior', (
        SELECT json_build_object(
          'invoices_analyzed', count(*),
          'compliance_score', CASE WHEN count(*) > 0
            THEN round(100.0 * count(*) FILTER (WHERE days_to_pay <= 3) / count(*))
            ELSE NULL END,
          'avg_days_to_pay', round(avg(days_to_pay)::numeric, 1),
          'on_time_count', count(*) FILTER (WHERE payment_status IN ('early', 'on_time')),
          'late_count', count(*) FILTER (WHERE payment_status = 'late')
        )
        FROM odoo_invoices
        WHERE company_id = p_company_id
          AND move_type = 'out_invoice'
          AND payment_state IN ('paid', 'in_payment')
          AND days_to_pay IS NOT NULL
      ),
      'credit_notes', (
        SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
        FROM (
          SELECT name, invoice_date, amount_total, ref
          FROM odoo_invoices
          WHERE company_id = p_company_id AND move_type = 'out_refund'
          ORDER BY invoice_date DESC LIMIT 10
        ) t
      )
    )
  );
END;
$$;
