-- Fix urgente 2026-04-17 · aplicada via MCP en prod.
--
-- Problema: la migración M3 (`m3_payment_predictions_filter_state_residual`)
-- ejecutó `DROP MATERIALIZED VIEW IF EXISTS payment_predictions CASCADE`.
-- El CASCADE se llevó por adelante:
--   - cashflow_company_behavior     (direct dep — recreado dentro de M3)
--   - cashflow_ar_predicted         (LEFT JOIN cashflow_company_behavior)
--   - cashflow_so_backlog           (LEFT JOIN cashflow_company_behavior)
--   - projected_cash_flow_weekly    (depende de ar_predicted + so_backlog)
--
-- Consecuencia: /finanzas perdió la proyección 13s y las
-- recomendaciones de cashflow — RPC `get_projected_cash_flow_summary()`
-- y `get_cashflow_recommendations()` fallaban con "relation does not exist".
--
-- Fix: recrear las 3 views faltantes desde las defs más recientes en git
-- (20260416 v3). Orden: ar_predicted → so_backlog → projected_cash_flow_weekly.
--
-- Lesson learned: al DROP CASCADE una matview, enumerar explícitamente
-- todos los dependents antes y recrearlos dentro de la misma migración.

-- ─── cashflow_ar_predicted (v3 — originalmente en 20260416_cashflow_v3_profile_driven_predictions.sql) ──
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

-- ─── cashflow_so_backlog (v3 — originalmente en 20260416_cashflow_v3_so_po_backlog_profiles.sql) ──
CREATE OR REPLACE VIEW cashflow_so_backlog AS
WITH backlog_lines AS (
  SELECT ol.odoo_order_id, ol.odoo_partner_id,
    SUM((GREATEST(ol.qty - COALESCE(ol.qty_invoiced, 0), 0) / NULLIF(ol.qty, 0))
        * COALESCE(ol.subtotal_mxn, ol.subtotal, 0))::numeric AS pending_mxn
  FROM odoo_order_lines ol
  WHERE ol.order_type = 'sale' AND ol.order_state IN ('sale','done')
    AND ol.qty > COALESCE(ol.qty_invoiced, 0) AND ol.qty > 0
    AND ol.order_date >= CURRENT_DATE - INTERVAL '12 months'
  GROUP BY ol.odoo_order_id, ol.odoo_partner_id
  HAVING SUM(GREATEST(ol.qty - COALESCE(ol.qty_invoiced, 0), 0)) > 0
     AND SUM((GREATEST(ol.qty - COALESCE(ol.qty_invoiced, 0), 0) / NULLIF(ol.qty, 0))
             * COALESCE(ol.subtotal_mxn, ol.subtotal, 0)) > 0
)
SELECT so.odoo_order_id, so.name, so.company_id, so.commitment_date, so.date_order,
  bl.pending_mxn,
  COALESCE(so.commitment_date, so.date_order + INTERVAL '30 days')::date AS predicted_invoice_date,
  CASE
    WHEN pp.median_days_to_pay IS NOT NULL THEN
      snap_to_day_of_month(
        GREATEST(CURRENT_DATE,
          (COALESCE(so.commitment_date, so.date_order + INTERVAL '30 days')
           + pp.median_days_to_pay::int * INTERVAL '1 day')::date),
        pp.typical_day_of_month)
    WHEN b.avg_days IS NOT NULL THEN
      (COALESCE(so.commitment_date, so.date_order + INTERVAL '30 days')::date
       + (LEAST(b.avg_days, 180))::int * INTERVAL '1 day')::date
    ELSE (COALESCE(so.commitment_date, so.date_order + INTERVAL '30 days') + INTERVAL '39 days')::date
  END AS predicted_payment_date,
  (0.65 * CASE
    WHEN pp.confidence IS NOT NULL THEN
      pp.confidence * CASE
        WHEN COALESCE(pp.stddev_days_to_pay, 999) < 15 THEN 0.90
        WHEN COALESCE(pp.stddev_days_to_pay, 999) < 30 THEN 0.75
        ELSE 0.60 END
    WHEN b.confidence IS NOT NULL THEN b.confidence
    ELSE 0.50
  END)::numeric AS confidence
FROM odoo_sale_orders so
JOIN backlog_lines bl ON bl.odoo_order_id = so.odoo_order_id
LEFT JOIN partner_payment_profile pp
  ON pp.odoo_partner_id = bl.odoo_partner_id AND pp.payment_type = 'inbound'
LEFT JOIN cashflow_company_behavior b ON b.company_id = so.company_id
WHERE so.state IN ('sale','done');

-- ─── projected_cash_flow_weekly (v3 — originalmente en 20260416_cashflow_v3_so_po_backlog_profiles.sql) ──
CREATE OR REPLACE VIEW projected_cash_flow_weekly AS
WITH
  params AS (SELECT (date_trunc('week', CURRENT_DATE))::date AS monday),
  weeks AS (SELECT gs::int AS week_index, (p.monday+gs*7)::date AS week_start, (p.monday+gs*7+6)::date AS week_end FROM params p CROSS JOIN generate_series(0,12) gs),
  ar_raw AS (SELECT w.week_index, COALESCE(SUM(ar.residual_mxn),0)::numeric AS gross, COALESCE(SUM(ar.residual_mxn*ar.confidence),0)::numeric AS weighted, COALESCE(SUM(CASE WHEN ar.days_overdue>0 THEN ar.residual_mxn ELSE 0 END),0)::numeric AS overdue_gross FROM weeks w LEFT JOIN cashflow_ar_predicted ar ON ar.predicted_payment_date BETWEEN w.week_start AND w.week_end GROUP BY w.week_index),
  ar_by_week AS (SELECT ar.week_index, GREATEST(ar.gross-CASE WHEN ar.week_index=0 THEN (SELECT unmatched_inbound_mxn FROM cashflow_unreconciled) ELSE 0 END,0) AS gross, GREATEST(ar.weighted-CASE WHEN ar.week_index=0 THEN (SELECT unmatched_inbound_mxn FROM cashflow_unreconciled) ELSE 0 END,0) AS weighted, ar.overdue_gross FROM ar_raw ar),
  so_by_week AS (SELECT w.week_index, COALESCE(SUM(so.pending_mxn),0)::numeric AS gross, COALESCE(SUM(so.pending_mxn*so.confidence),0)::numeric AS weighted FROM weeks w LEFT JOIN cashflow_so_backlog so ON so.predicted_payment_date BETWEEN w.week_start AND w.week_end GROUP BY w.week_index),
  ap_raw AS (SELECT w.week_index, COALESCE(SUM(ap.residual_mxn),0)::numeric AS gross, COALESCE(SUM(ap.residual_mxn*ap.confidence),0)::numeric AS weighted, COALESCE(SUM(CASE WHEN ap.days_overdue>0 THEN ap.residual_mxn ELSE 0 END),0)::numeric AS overdue_gross FROM weeks w LEFT JOIN cashflow_ap_predicted ap ON ap.predicted_payment_date BETWEEN w.week_start AND w.week_end GROUP BY w.week_index),
  ap_by_week AS (SELECT ap.week_index, GREATEST(ap.gross-CASE WHEN ap.week_index=0 THEN (SELECT unmatched_outbound_mxn FROM cashflow_unreconciled) ELSE 0 END,0) AS gross, GREATEST(ap.weighted-CASE WHEN ap.week_index=0 THEN (SELECT unmatched_outbound_mxn FROM cashflow_unreconciled) ELSE 0 END,0) AS weighted, ap.overdue_gross FROM ap_raw ap),
  po_by_week AS (SELECT w.week_index, COALESCE(SUM(po.pending_mxn),0)::numeric AS gross, COALESCE(SUM(po.pending_mxn*po.confidence),0)::numeric AS weighted FROM weeks w LEFT JOIN cashflow_po_backlog po ON po.predicted_payment_date BETWEEN w.week_start AND w.week_end GROUP BY w.week_index),
  payroll_events AS (SELECT w.week_index, (CASE WHEN EXISTS (SELECT 1 FROM generate_series(w.week_start,w.week_end,INTERVAL '1 day') d WHERE EXTRACT(DAY FROM d)=15) THEN (SELECT monthly_mxn FROM cashflow_payroll_monthly)/2.0 ELSE 0 END + CASE WHEN EXISTS (SELECT 1 FROM generate_series(w.week_start,w.week_end,INTERVAL '1 day') d WHERE d::date=(date_trunc('month',d)+INTERVAL '1 month - 1 day')::date) THEN (SELECT monthly_mxn FROM cashflow_payroll_monthly)/2.0 ELSE 0 END)::numeric AS payroll_amount FROM weeks w),
  tax_events AS (SELECT w.week_index, (CASE WHEN EXISTS (SELECT 1 FROM generate_series(w.week_start,w.week_end,INTERVAL '1 day') d WHERE EXTRACT(DAY FROM d)=17) THEN (SELECT monthly_mxn FROM cashflow_tax_monthly) ELSE 0 END)::numeric AS tax_amount FROM weeks w),
  base AS (SELECT w.week_index, w.week_start, w.week_end,
    ROUND(ar.gross,2) AS ar_gross, ROUND(ar.weighted,2) AS ar_weighted, ROUND(ar.overdue_gross,2) AS ar_overdue_gross,
    ROUND(so.gross,2) AS so_gross, ROUND(so.weighted,2) AS so_weighted,
    ROUND(ap.gross,2) AS ap_gross, ROUND(ap.weighted,2) AS ap_weighted, ROUND(ap.overdue_gross,2) AS ap_overdue_gross,
    ROUND(po.gross,2) AS po_gross, ROUND(po.weighted,2) AS po_weighted,
    ROUND(pe.payroll_amount,2) AS payroll_estimated,
    ROUND(((SELECT monthly_mxn FROM cashflow_opex_monthly)/4.3333)::numeric,2) AS opex_recurring,
    ROUND(te.tax_amount,2) AS tax_estimated
  FROM weeks w JOIN ar_by_week ar USING(week_index) JOIN so_by_week so USING(week_index) JOIN ap_by_week ap USING(week_index) JOIN po_by_week po USING(week_index) JOIN payroll_events pe USING(week_index) JOIN tax_events te USING(week_index)),
  flows AS (SELECT b.*, (b.ar_weighted+b.so_weighted) AS inflows_weighted, (b.ar_gross+b.so_gross) AS inflows_gross,
    (b.ap_weighted+b.po_weighted+b.payroll_estimated+b.opex_recurring+b.tax_estimated) AS outflows_weighted,
    (b.ap_gross+b.po_gross+b.payroll_estimated+b.opex_recurring+b.tax_estimated) AS outflows_gross,
    ((b.ar_weighted+b.so_weighted)-(b.ap_weighted+b.po_weighted+b.payroll_estimated+b.opex_recurring+b.tax_estimated)) AS net_flow FROM base b)
SELECT f.week_index, f.week_start, f.week_end,
  f.ar_gross, f.ar_weighted, f.ar_overdue_gross, f.so_gross, f.so_weighted,
  f.ap_gross, f.ap_weighted, f.ap_overdue_gross, f.po_gross, f.po_weighted,
  f.payroll_estimated, f.opex_recurring, f.tax_estimated,
  ROUND(f.inflows_weighted::numeric,2) AS inflows_weighted, ROUND(f.inflows_gross::numeric,2) AS inflows_gross,
  ROUND(f.outflows_weighted::numeric,2) AS outflows_weighted, ROUND(f.outflows_gross::numeric,2) AS outflows_gross,
  ROUND(f.net_flow::numeric,2) AS net_flow,
  ROUND(((SELECT cash_net_mxn FROM cashflow_current_cash)+(SELECT in_transit_mxn FROM cashflow_in_transit)+COALESCE(SUM(f.net_flow) OVER (ORDER BY f.week_index ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0))::numeric,2) AS opening_balance,
  ROUND(((SELECT cash_net_mxn FROM cashflow_current_cash)+(SELECT in_transit_mxn FROM cashflow_in_transit)+SUM(f.net_flow) OVER (ORDER BY f.week_index ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))::numeric,2) AS closing_balance
FROM flows f ORDER BY f.week_index;
