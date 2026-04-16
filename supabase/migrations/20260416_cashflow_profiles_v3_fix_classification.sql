-- ═══════════════════════════════════════════════════════════════
-- Fix clasificación de cuentas fiscales + recrear cadena CASCADE
-- ═══════════════════════════════════════════════════════════════
-- Mejoras en regex de categorización:
--  • ISR provisional (pagos provisionales) → tax_isr_provisional ($257K/mes)
--  • IVA a favor → tax_iva_credit (no es cash flow activo)
--  • IVA pendiente de acreditar → tax_iva_paid
--  • ISR retenido sueldos / inversiones → tax_isr_withheld
--  • IMSS por pagar / SAR / Fonacot → tax_imss
--  • Impuestos por pagar genéricos → tax_other
--  • Préstamos bancarios → loan_bank
--  • Fondo de ahorro / cuotas sindicales → payroll_regular
--
-- Resultado: tax mensual subió de $340K a $965K (más realista).
-- ═══════════════════════════════════════════════════════════════

-- NOTA: DROP MATERIALIZED VIEW ... CASCADE elimina toda la cadena:
--   account_payment_profile
--   → cashflow_payroll_monthly / opex / tax
--   → projected_cash_flow_weekly
-- Por eso este archivo recrea TODO.

DROP MATERIALIZED VIEW IF EXISTS account_payment_profile CASCADE;

CREATE MATERIALIZED VIEW account_payment_profile AS
WITH base AS (
  SELECT
    b.odoo_account_id,
    coa.code                                                          AS account_code,
    coa.name                                                          AS account_name,
    coa.account_type,
    b.period,
    EXTRACT(MONTH FROM to_date(b.period || '-01', 'YYYY-MM-DD'))::int AS month_of_year,
    (b.debit - b.credit)                                              AS net_flow
  FROM odoo_account_balances b
  JOIN odoo_chart_of_accounts coa
    ON coa.odoo_account_id = b.odoo_account_id
  WHERE b.period >= to_char(CURRENT_DATE - INTERVAL '24 months', 'YYYY-MM')
    AND b.period <  to_char(CURRENT_DATE, 'YYYY-MM')
),
stats AS (
  SELECT
    odoo_account_id,
    MAX(account_code)     AS account_code,
    MAX(account_name)     AS account_name,
    MAX(account_type)     AS account_type,
    COUNT(*)              AS months_with_activity,
    COUNT(*) FILTER (WHERE period >= to_char(CURRENT_DATE - INTERVAL '12 months', 'YYYY-MM'))
                          AS months_in_last_12m,
    ROUND(AVG(net_flow)::numeric, 2)                                  AS avg_monthly_net,
    ROUND(STDDEV(net_flow)::numeric, 2)                               AS stddev_monthly_net,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY net_flow)::numeric(20,2)
                                                                      AS median_monthly_net,
    MODE() WITHIN GROUP (ORDER BY month_of_year)                      AS typical_month,
    MAX(period)                                                       AS last_period_active
  FROM base
  GROUP BY odoo_account_id
),
categorized AS (
  SELECT s.*,
    CASE
      WHEN s.account_name ~* '(pagos provisionales.*isr|isr.*del ejercicio|isr.*pm.*favor)'          THEN 'tax_isr_provisional'
      WHEN s.account_name ~* '(iva trasladado|iva cobrado|iva por trasladar|iva por pagar|iva trasladado no cobrado)' THEN 'tax_iva_collected'
      WHEN s.account_name ~* '(iva acreditable|iva pagado|iva por acreditar|iva.*pendiente de pago|iva de importaci)' THEN 'tax_iva_paid'
      WHEN s.account_name ~* 'iva.*a favor'                                                           THEN 'tax_iva_credit'
      WHEN s.account_name ~* 'iva pendiente de acreditar'                                             THEN 'tax_iva_paid'
      WHEN s.account_name ~* '(iva ret|retencion.*iva|iva retenido|resico)'                           THEN 'tax_withheld_iva'
      WHEN s.account_name ~* '(isr.*retenid|retenc.*isr|isr.*honorario|isr.*arrendamiento|retencion.*renta|impuesto sobre.*renta.*sueld|i\.s\.r\..*retenido)' THEN 'tax_isr_withheld'
      WHEN s.account_name ~* '(imss|seguro social|cuota.*imss|retenc.*imss|i\.m\.s\.s)'               THEN 'tax_imss'
      WHEN s.account_name ~* 'infonavit'                                                              THEN 'tax_infonavit'
      WHEN s.account_name ~* '(s\.a\.r\.|fonacot)'                                                    THEN 'tax_imss'
      WHEN s.account_name ~* '(impuesto.*sobre.*nomin|nomina estatal|nómina estatal)'                 THEN 'tax_payroll_state'
      WHEN s.account_name ~* '(ptu|reparto.*utilidad)'                                                THEN 'tax_ptu'
      WHEN s.account_name ~* '(impuestos? por pagar|impuestos? y derechos|impuesto verde|otros impuestos)' THEN 'tax_other'
      WHEN s.account_name ~* 'aguinald'                                                               THEN 'payroll_aguinaldo'
      WHEN s.account_name ~* '(sueld|salari|^nomin|prestacione|vacacion|prima vacacional|provision.*sueld|fondo de ahorro|ayuda.*defunci|cuotas sindicales)' THEN 'payroll_regular'
      WHEN s.account_name ~* '(nomina|nómina)' AND s.account_type = 'liability_payable'               THEN 'payroll_regular'
      WHEN s.account_name ~* '(prestamo|préstamo).*bancar'                                            THEN 'loan_bank'
      WHEN s.account_type = 'asset_receivable'       THEN 'ar_customer'
      WHEN s.account_type = 'liability_payable'       THEN 'ap_supplier'
      WHEN s.account_type = 'asset_cash'              THEN 'cash_bank'
      WHEN s.account_type = 'liability_credit_card'   THEN 'credit_card'
      WHEN s.account_type = 'income'                  THEN 'revenue'
      WHEN s.account_type = 'income_other'            THEN 'revenue_other'
      WHEN s.account_type = 'expense_direct_cost'     THEN 'cogs'
      WHEN s.account_type IN ('expense','expense_other') THEN 'opex_recurring'
      WHEN s.account_type = 'expense_depreciation'    THEN 'depreciation'
      WHEN s.account_type IN ('asset_fixed','asset_non_current') THEN 'capex'
      WHEN s.account_type = 'asset_prepayments'       THEN 'prepayment'
      WHEN s.account_type = 'asset_current'           THEN 'asset_other'
      WHEN s.account_type = 'liability_current'       THEN 'liability_other'
      WHEN s.account_type = 'liability_non_current'   THEN 'liability_long_term'
      WHEN s.account_type LIKE 'equity%'              THEN 'equity'
      ELSE 'other'
    END AS detected_category
  FROM stats s
)
SELECT c.*,
  CASE
    WHEN c.months_in_last_12m >= 11 THEN 'monthly'
    WHEN c.months_in_last_12m BETWEEN 5 AND 10 THEN 'irregular_monthly'
    WHEN c.months_in_last_12m BETWEEN 1 AND 4  THEN 'occasional'
    ELSE 'dormant'
  END AS frequency,
  LEAST(1.0, (c.months_in_last_12m / 12.0)::numeric)::numeric(4,3) AS confidence,
  NOW() AS computed_at
FROM categorized c;

CREATE UNIQUE INDEX idx_account_payment_profile_pk ON account_payment_profile (odoo_account_id);
CREATE INDEX idx_account_payment_profile_category ON account_payment_profile (detected_category);
CREATE INDEX idx_account_payment_profile_frequency ON account_payment_profile (frequency);

-- ─── Recrear views dependientes ───────────────────────────────

CREATE OR REPLACE VIEW cashflow_payroll_monthly AS
SELECT
  COALESCE(SUM(avg_monthly_net) FILTER (
    WHERE detected_category = 'payroll_regular' AND frequency IN ('monthly','irregular_monthly')
  ), 0)::numeric AS monthly_mxn,
  COUNT(*) FILTER (WHERE detected_category = 'payroll_regular' AND frequency = 'monthly')::int AS months_used,
  'account_payment_profile'::text AS periods
FROM account_payment_profile;

CREATE OR REPLACE VIEW cashflow_opex_monthly AS
SELECT
  COALESCE(SUM(avg_monthly_net) FILTER (
    WHERE detected_category = 'opex_recurring' AND frequency IN ('monthly','irregular_monthly')
  ), 0)::numeric AS monthly_mxn,
  COUNT(*) FILTER (WHERE detected_category = 'opex_recurring' AND frequency = 'monthly')::int AS months_used,
  'account_payment_profile'::text AS periods
FROM account_payment_profile;

CREATE OR REPLACE VIEW cashflow_tax_monthly AS
SELECT
  GREATEST(COALESCE(SUM(avg_monthly_net) FILTER (
    WHERE detected_category LIKE 'tax_%' AND frequency IN ('monthly','irregular_monthly')
  ), 0), 0)::numeric AS monthly_mxn,
  COUNT(*) FILTER (WHERE detected_category LIKE 'tax_%' AND frequency = 'monthly')::int AS months_used
FROM account_payment_profile;

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

-- ─── Recrear projected_cash_flow_weekly ───────────────────────

CREATE OR REPLACE VIEW projected_cash_flow_weekly AS
WITH
  params AS (SELECT (date_trunc('week', CURRENT_DATE))::date AS monday),
  weeks AS (
    SELECT gs::int AS week_index,
           (p.monday + gs * 7)::date AS week_start,
           (p.monday + gs * 7 + 6)::date AS week_end
    FROM params p CROSS JOIN generate_series(0, 12) gs
  ),
  ar_raw AS (
    SELECT w.week_index,
      COALESCE(SUM(ar.residual_mxn), 0)::numeric AS gross,
      COALESCE(SUM(ar.residual_mxn * ar.confidence), 0)::numeric AS weighted,
      COALESCE(SUM(CASE WHEN ar.days_overdue > 0 THEN ar.residual_mxn ELSE 0 END), 0)::numeric AS overdue_gross
    FROM weeks w LEFT JOIN cashflow_ar_predicted ar
      ON ar.predicted_payment_date BETWEEN w.week_start AND w.week_end
    GROUP BY w.week_index
  ),
  ar_by_week AS (
    SELECT ar.week_index,
      GREATEST(ar.gross - CASE WHEN ar.week_index = 0 THEN (SELECT unmatched_inbound_mxn FROM cashflow_unreconciled) ELSE 0 END, 0) AS gross,
      GREATEST(ar.weighted - CASE WHEN ar.week_index = 0 THEN (SELECT unmatched_inbound_mxn FROM cashflow_unreconciled) ELSE 0 END, 0) AS weighted,
      ar.overdue_gross
    FROM ar_raw ar
  ),
  so_by_week AS (
    SELECT w.week_index,
      COALESCE(SUM(so.pending_mxn), 0)::numeric AS gross,
      COALESCE(SUM(so.pending_mxn * so.confidence), 0)::numeric AS weighted
    FROM weeks w LEFT JOIN cashflow_so_backlog so
      ON so.predicted_payment_date BETWEEN w.week_start AND w.week_end
    GROUP BY w.week_index
  ),
  ap_raw AS (
    SELECT w.week_index,
      COALESCE(SUM(ap.residual_mxn), 0)::numeric AS gross,
      COALESCE(SUM(ap.residual_mxn * ap.confidence), 0)::numeric AS weighted,
      COALESCE(SUM(CASE WHEN ap.days_overdue > 0 THEN ap.residual_mxn ELSE 0 END), 0)::numeric AS overdue_gross
    FROM weeks w LEFT JOIN cashflow_ap_predicted ap
      ON ap.predicted_payment_date BETWEEN w.week_start AND w.week_end
    GROUP BY w.week_index
  ),
  ap_by_week AS (
    SELECT ap.week_index,
      GREATEST(ap.gross - CASE WHEN ap.week_index = 0 THEN (SELECT unmatched_outbound_mxn FROM cashflow_unreconciled) ELSE 0 END, 0) AS gross,
      GREATEST(ap.weighted - CASE WHEN ap.week_index = 0 THEN (SELECT unmatched_outbound_mxn FROM cashflow_unreconciled) ELSE 0 END, 0) AS weighted,
      ap.overdue_gross
    FROM ap_raw ap
  ),
  po_by_week AS (
    SELECT w.week_index,
      COALESCE(SUM(po.pending_mxn), 0)::numeric AS gross,
      COALESCE(SUM(po.pending_mxn * po.confidence), 0)::numeric AS weighted
    FROM weeks w LEFT JOIN cashflow_po_backlog po
      ON po.predicted_payment_date BETWEEN w.week_start AND w.week_end
    GROUP BY w.week_index
  ),
  payroll_events AS (
    SELECT w.week_index,
      (CASE WHEN EXISTS (
        SELECT 1 FROM generate_series(w.week_start, w.week_end, INTERVAL '1 day') d WHERE EXTRACT(DAY FROM d) = 15
      ) THEN (SELECT monthly_mxn FROM cashflow_payroll_monthly) / 2.0 ELSE 0 END
      + CASE WHEN EXISTS (
        SELECT 1 FROM generate_series(w.week_start, w.week_end, INTERVAL '1 day') d WHERE d::date = (date_trunc('month', d) + INTERVAL '1 month - 1 day')::date
      ) THEN (SELECT monthly_mxn FROM cashflow_payroll_monthly) / 2.0 ELSE 0 END
      )::numeric AS payroll_amount
    FROM weeks w
  ),
  tax_events AS (
    SELECT w.week_index,
      (CASE WHEN EXISTS (
        SELECT 1 FROM generate_series(w.week_start, w.week_end, INTERVAL '1 day') d WHERE EXTRACT(DAY FROM d) = 17
      ) THEN (SELECT monthly_mxn FROM cashflow_tax_monthly) ELSE 0 END)::numeric AS tax_amount
    FROM weeks w
  ),
  base AS (
    SELECT w.week_index, w.week_start, w.week_end,
      ROUND(ar.gross, 2) AS ar_gross, ROUND(ar.weighted, 2) AS ar_weighted, ROUND(ar.overdue_gross, 2) AS ar_overdue_gross,
      ROUND(so.gross, 2) AS so_gross, ROUND(so.weighted, 2) AS so_weighted,
      ROUND(ap.gross, 2) AS ap_gross, ROUND(ap.weighted, 2) AS ap_weighted, ROUND(ap.overdue_gross, 2) AS ap_overdue_gross,
      ROUND(po.gross, 2) AS po_gross, ROUND(po.weighted, 2) AS po_weighted,
      ROUND(pe.payroll_amount, 2) AS payroll_estimated,
      ROUND(((SELECT monthly_mxn FROM cashflow_opex_monthly) / 4.3333)::numeric, 2) AS opex_recurring,
      ROUND(te.tax_amount, 2) AS tax_estimated
    FROM weeks w
    JOIN ar_by_week ar USING (week_index) JOIN so_by_week so USING (week_index)
    JOIN ap_by_week ap USING (week_index) JOIN po_by_week po USING (week_index)
    JOIN payroll_events pe USING (week_index) JOIN tax_events te USING (week_index)
  ),
  flows AS (
    SELECT b.*,
      (b.ar_weighted + b.so_weighted) AS inflows_weighted,
      (b.ar_gross + b.so_gross) AS inflows_gross,
      (b.ap_weighted + b.po_weighted + b.payroll_estimated + b.opex_recurring + b.tax_estimated) AS outflows_weighted,
      (b.ap_gross + b.po_gross + b.payroll_estimated + b.opex_recurring + b.tax_estimated) AS outflows_gross,
      ((b.ar_weighted + b.so_weighted) - (b.ap_weighted + b.po_weighted + b.payroll_estimated + b.opex_recurring + b.tax_estimated)) AS net_flow
    FROM base b
  )
SELECT f.week_index, f.week_start, f.week_end,
  f.ar_gross, f.ar_weighted, f.ar_overdue_gross,
  f.so_gross, f.so_weighted,
  f.ap_gross, f.ap_weighted, f.ap_overdue_gross,
  f.po_gross, f.po_weighted,
  f.payroll_estimated, f.opex_recurring, f.tax_estimated,
  ROUND(f.inflows_weighted::numeric, 2) AS inflows_weighted,
  ROUND(f.inflows_gross::numeric, 2) AS inflows_gross,
  ROUND(f.outflows_weighted::numeric, 2) AS outflows_weighted,
  ROUND(f.outflows_gross::numeric, 2) AS outflows_gross,
  ROUND(f.net_flow::numeric, 2) AS net_flow,
  ROUND(((SELECT cash_net_mxn FROM cashflow_current_cash) + (SELECT in_transit_mxn FROM cashflow_in_transit)
    + COALESCE(SUM(f.net_flow) OVER (ORDER BY f.week_index ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0))::numeric, 2) AS opening_balance,
  ROUND(((SELECT cash_net_mxn FROM cashflow_current_cash) + (SELECT in_transit_mxn FROM cashflow_in_transit)
    + SUM(f.net_flow) OVER (ORDER BY f.week_index ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))::numeric, 2) AS closing_balance
FROM flows f ORDER BY f.week_index;

-- ─── Refresh function ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION refresh_cashflow_profiles()
RETURNS TABLE(view_name text, row_count bigint, refreshed_at timestamptz)
LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY partner_payment_profile;
  REFRESH MATERIALIZED VIEW CONCURRENTLY journal_flow_profile;
  REFRESH MATERIALIZED VIEW CONCURRENTLY account_payment_profile;
  RETURN QUERY
  SELECT 'partner_payment_profile'::text, COUNT(*)::bigint, NOW() FROM partner_payment_profile
  UNION ALL SELECT 'journal_flow_profile'::text, COUNT(*)::bigint, NOW() FROM journal_flow_profile
  UNION ALL SELECT 'account_payment_profile'::text, COUNT(*)::bigint, NOW() FROM account_payment_profile;
END;
$$;
