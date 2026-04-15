-- ═══════════════════════════════════════════════════════════════
-- Cashflow Profiles v3 · Phase 1
-- ═══════════════════════════════════════════════════════════════
-- Reemplaza los promedios ciegos de v2 por perfiles estadísticos
-- reales derivados de odoo_account_payments, odoo_invoices y
-- odoo_account_balances × odoo_chart_of_accounts.
--
-- Crea 3 materialized views:
--   1. partner_payment_profile   — comportamiento real por partner
--   2. journal_flow_profile      — baseline por banco
--   3. account_payment_profile   — frecuencia mensual + categoría
--
-- + función refresh_cashflow_profiles() para llamar desde cron.
--
-- Consumido por /finanzas#profiles en el frontend como sección
-- de validación antes del refactor a projected_cash_flow_weekly_v3.
-- ═══════════════════════════════════════════════════════════════

DROP MATERIALIZED VIEW IF EXISTS partner_payment_profile CASCADE;
DROP MATERIALIZED VIEW IF EXISTS journal_flow_profile CASCADE;
DROP MATERIALIZED VIEW IF EXISTS account_payment_profile CASCADE;

-- ───────────────────────────────────────────────────────────────
-- 1. partner_payment_profile
-- ───────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW partner_payment_profile AS
WITH payments_24m AS (
  SELECT
    p.odoo_partner_id,
    p.payment_type,
    p.journal_name,
    p.payment_method,
    p.amount,
    p.date,
    to_char(p.date, 'YYYY-MM')                  AS period,
    EXTRACT(DAY  FROM p.date)::int              AS day_of_month,
    EXTRACT(DOW  FROM p.date)::int              AS day_of_week
  FROM odoo_account_payments p
  WHERE p.date >= CURRENT_DATE - INTERVAL '24 months'
    AND p.odoo_partner_id IS NOT NULL
    AND p.state IN ('paid','in_process')
),
invoice_stats AS (
  SELECT
    i.odoo_partner_id,
    CASE
      WHEN i.move_type IN ('out_invoice','out_refund') THEN 'inbound'
      WHEN i.move_type IN ('in_invoice','in_refund')   THEN 'outbound'
    END                                                            AS payment_type,
    COUNT(*)                                                       AS invoice_count_24m,
    COUNT(*) FILTER (WHERE i.payment_state = 'paid')               AS paid_count,
    AVG(i.days_to_pay) FILTER (WHERE i.days_to_pay IS NOT NULL)    AS avg_days_to_pay,
    STDDEV(i.days_to_pay) FILTER (WHERE i.days_to_pay IS NOT NULL) AS stddev_days_to_pay,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY i.days_to_pay)
      FILTER (WHERE i.days_to_pay IS NOT NULL)                     AS median_days_to_pay,
    SUM(COALESCE(i.amount_total_mxn, i.amount_total))              AS total_invoiced_mxn,
    COUNT(*) FILTER (
      WHERE i.payment_state <> 'paid'
        AND CURRENT_DATE - i.invoice_date > 180
    )                                                              AS writeoff_risk_count
  FROM odoo_invoices i
  WHERE i.state = 'posted'
    AND i.invoice_date >= CURRENT_DATE - INTERVAL '24 months'
    AND i.odoo_partner_id IS NOT NULL
    AND i.move_type IN ('out_invoice','out_refund','in_invoice','in_refund')
  GROUP BY i.odoo_partner_id, payment_type
),
payment_stats AS (
  SELECT
    odoo_partner_id,
    payment_type,
    COUNT(*)                                                      AS payment_count,
    COUNT(DISTINCT period)                                        AS months_active,
    SUM(amount)                                                   AS total_paid_amount,
    AVG(amount)                                                   AS avg_payment_amount,
    STDDEV(amount)                                                AS stddev_payment_amount,
    MIN(date)                                                     AS first_payment_date,
    MAX(date)                                                     AS last_payment_date,
    MODE() WITHIN GROUP (ORDER BY day_of_month)                   AS typical_day_of_month,
    MODE() WITHIN GROUP (ORDER BY day_of_week)                    AS typical_day_of_week,
    MODE() WITHIN GROUP (ORDER BY journal_name)                   AS preferred_bank_journal,
    MODE() WITHIN GROUP (ORDER BY payment_method)                 AS preferred_payment_method
  FROM payments_24m
  GROUP BY odoo_partner_id, payment_type
)
SELECT
  COALESCE(ps.odoo_partner_id, ist.odoo_partner_id)                    AS odoo_partner_id,
  COALESCE(ps.payment_type, ist.payment_type)                          AS payment_type,
  COALESCE(ps.payment_count, 0)                                        AS payment_count_24m,
  COALESCE(ps.months_active, 0)                                        AS months_active,
  ROUND(COALESCE(ps.total_paid_amount, 0)::numeric, 2)                 AS total_paid_mxn,
  ROUND(COALESCE(ps.avg_payment_amount, 0)::numeric, 2)                AS avg_payment_amount,
  ROUND(COALESCE(ps.stddev_payment_amount, 0)::numeric, 2)             AS stddev_payment_amount,
  ps.first_payment_date,
  ps.last_payment_date,
  ps.typical_day_of_month,
  ps.typical_day_of_week,
  ps.preferred_bank_journal,
  ps.preferred_payment_method,
  COALESCE(ist.invoice_count_24m, 0)                                   AS invoice_count_24m,
  COALESCE(ist.paid_count, 0)                                          AS paid_invoice_count,
  ROUND(ist.avg_days_to_pay::numeric, 1)                               AS avg_days_to_pay,
  ROUND(ist.median_days_to_pay::numeric, 1)                            AS median_days_to_pay,
  ROUND(ist.stddev_days_to_pay::numeric, 1)                            AS stddev_days_to_pay,
  ROUND(COALESCE(ist.total_invoiced_mxn, 0)::numeric, 2)               AS total_invoiced_mxn,
  COALESCE(ist.writeoff_risk_count, 0)                                 AS writeoff_risk_count,
  CASE
    WHEN COALESCE(ist.invoice_count_24m, 0) = 0 THEN 0
    ELSE ROUND(
      (ist.writeoff_risk_count::numeric / NULLIF(ist.invoice_count_24m, 0)) * 100,
      1
    )
  END                                                                  AS writeoff_risk_pct,
  LEAST(
    1.0,
    (COALESCE(ps.payment_count, 0) / 12.0) * 0.5
    + (COALESCE(ps.months_active, 0) / 12.0) * 0.5
  )::numeric(4,3)                                                      AS confidence,
  NOW()                                                                AS computed_at
FROM payment_stats ps
FULL OUTER JOIN invoice_stats ist
  ON  ist.odoo_partner_id = ps.odoo_partner_id
  AND ist.payment_type    = ps.payment_type;

CREATE UNIQUE INDEX idx_partner_payment_profile_pk
  ON partner_payment_profile (odoo_partner_id, payment_type);
CREATE INDEX idx_partner_payment_profile_confidence
  ON partner_payment_profile (confidence DESC);

COMMENT ON MATERIALIZED VIEW partner_payment_profile IS
  'Perfil estadístico de pago por partner × tipo, últimos 24m. '
  'Reemplaza cashflow_company_behavior con más dimensiones: timing, '
  'banco preferido, método, y riesgo de write-off.';

-- ───────────────────────────────────────────────────────────────
-- 2. journal_flow_profile
-- ───────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW journal_flow_profile AS
WITH monthly AS (
  SELECT
    p.journal_name,
    p.payment_type,
    to_char(p.date, 'YYYY-MM')                  AS period,
    SUM(p.amount)                               AS period_total,
    COUNT(*)                                    AS period_count
  FROM odoo_account_payments p
  WHERE p.date >= CURRENT_DATE - INTERVAL '12 months'
    AND p.state IN ('paid','in_process')
  GROUP BY p.journal_name, p.payment_type, period
),
top_partners AS (
  SELECT
    p.journal_name,
    p.payment_type,
    p.odoo_partner_id,
    SUM(p.amount) AS partner_total,
    ROW_NUMBER() OVER (
      PARTITION BY p.journal_name, p.payment_type
      ORDER BY SUM(p.amount) DESC
    ) AS rnk
  FROM odoo_account_payments p
  WHERE p.date >= CURRENT_DATE - INTERVAL '12 months'
    AND p.state IN ('paid','in_process')
    AND p.odoo_partner_id IS NOT NULL
  GROUP BY p.journal_name, p.payment_type, p.odoo_partner_id
),
top5 AS (
  SELECT
    journal_name,
    payment_type,
    ARRAY_AGG(odoo_partner_id ORDER BY partner_total DESC) AS top5_partner_ids
  FROM top_partners
  WHERE rnk <= 5
  GROUP BY journal_name, payment_type
)
SELECT
  m.journal_name,
  m.payment_type,
  COUNT(DISTINCT m.period)                                            AS months_active,
  SUM(m.period_count)                                                 AS total_payments_12m,
  ROUND(SUM(m.period_total)::numeric, 2)                              AS total_amount_12m,
  ROUND(AVG(m.period_total)::numeric, 2)                              AS avg_monthly_amount,
  ROUND(STDDEV(m.period_total)::numeric, 2)                           AS stddev_monthly_amount,
  ROUND((STDDEV(m.period_total) / NULLIF(AVG(m.period_total), 0))::numeric, 3)
                                                                      AS volatility_cv,
  t.top5_partner_ids,
  NOW()                                                               AS computed_at
FROM monthly m
LEFT JOIN top5 t
  ON  t.journal_name = m.journal_name
  AND t.payment_type = m.payment_type
GROUP BY m.journal_name, m.payment_type, t.top5_partner_ids;

CREATE UNIQUE INDEX idx_journal_flow_profile_pk
  ON journal_flow_profile (journal_name, payment_type);

COMMENT ON MATERIALIZED VIEW journal_flow_profile IS
  'Baseline de flujo por journal (banco) de últimos 12m. '
  'Útil para proyectar monthly_inflow/outflow por banco y detectar volatilidad.';

-- ───────────────────────────────────────────────────────────────
-- 3. account_payment_profile
-- ───────────────────────────────────────────────────────────────
-- NOTA: odoo_account_balances.account_name/code/type están vacíos
-- por un bug del sync qb19 (pendiente de deploy). Workaround: JOIN
-- contra odoo_chart_of_accounts para obtener los campos reales.
-- ───────────────────────────────────────────────────────────────
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
    MAX(account_code)                                                 AS account_code,
    MAX(account_name)                                                 AS account_name,
    MAX(account_type)                                                 AS account_type,
    COUNT(*)                                                          AS months_with_activity,
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
  SELECT
    s.*,
    CASE
      WHEN s.account_name ~* '(iva trasladado|iva cobrado|iva por trasladar|iva por pagar)'          THEN 'tax_iva_collected'
      WHEN s.account_name ~* '(iva acreditable|iva pagado|iva por acreditar|iva.*pendiente de pago|iva a favor)' THEN 'tax_iva_paid'
      WHEN s.account_name ~* '(isr.*retenid|retenc.*isr|isr.*honorario|isr.*arrendamiento|retencion.*renta|impuesto sobre.*renta.*sueld)' THEN 'tax_isr_withheld'
      WHEN s.account_name ~* '(isr.*por pagar)'                                                      THEN 'tax_isr_corporate'
      WHEN s.account_name ~* '(imss|seguro social|cuota.*imss|retenc.*imss)'                         THEN 'tax_imss'
      WHEN s.account_name ~* 'infonavit'                                                             THEN 'tax_infonavit'
      WHEN s.account_name ~* '(iva ret|retencion.*iva|iva retenido|resico)'                          THEN 'tax_withheld_other'
      WHEN s.account_name ~* '(impuesto.*sobre.*nomin|nomina estatal)'                               THEN 'tax_payroll_state'
      WHEN s.account_name ~* '(ptu|reparto.*utilidad)'                                               THEN 'tax_ptu'
      WHEN s.account_name ~* 'aguinald'                                                              THEN 'payroll_aguinaldo'
      WHEN s.account_name ~* '(sueld|salari|^nomin|prestacione|vacacion|prima vacacional)'           THEN 'payroll_regular'
      WHEN s.account_type = 'asset_receivable'                                                       THEN 'ar_customer'
      WHEN s.account_type = 'liability_payable'                                                      THEN 'ap_supplier'
      WHEN s.account_type = 'asset_cash'                                                             THEN 'cash_bank'
      WHEN s.account_type = 'liability_credit_card'                                                  THEN 'credit_card'
      WHEN s.account_type = 'income'                                                                 THEN 'revenue'
      WHEN s.account_type = 'income_other'                                                           THEN 'revenue_other'
      WHEN s.account_type = 'expense_direct_cost'                                                    THEN 'cogs'
      WHEN s.account_type IN ('expense','expense_other')                                             THEN 'opex_recurring'
      WHEN s.account_type = 'expense_depreciation'                                                   THEN 'depreciation'
      WHEN s.account_type IN ('asset_fixed','asset_non_current')                                     THEN 'capex'
      WHEN s.account_type = 'asset_prepayments'                                                      THEN 'prepayment'
      WHEN s.account_type = 'asset_current'                                                          THEN 'asset_other'
      WHEN s.account_type = 'liability_current'                                                      THEN 'liability_other'
      WHEN s.account_type = 'liability_non_current'                                                  THEN 'liability_long_term'
      WHEN s.account_type LIKE 'equity%'                                                             THEN 'equity'
      ELSE 'other'
    END                                                               AS detected_category
  FROM stats s
)
SELECT
  c.*,
  CASE
    WHEN c.months_in_last_12m >= 11 THEN 'monthly'
    WHEN c.months_in_last_12m BETWEEN 5 AND 10 THEN 'irregular_monthly'
    WHEN c.months_in_last_12m BETWEEN 1 AND 4  THEN 'occasional'
    ELSE 'dormant'
  END                                                                 AS frequency,
  LEAST(1.0, (c.months_in_last_12m / 12.0)::numeric)::numeric(4,3)    AS confidence,
  NOW()                                                               AS computed_at
FROM categorized c;

CREATE UNIQUE INDEX idx_account_payment_profile_pk
  ON account_payment_profile (odoo_account_id);
CREATE INDEX idx_account_payment_profile_category
  ON account_payment_profile (detected_category);
CREATE INDEX idx_account_payment_profile_frequency
  ON account_payment_profile (frequency);

COMMENT ON MATERIALIZED VIEW account_payment_profile IS
  'Perfil mensual por cuenta contable con categorización automática. '
  'Fuente: odoo_account_balances × odoo_chart_of_accounts (agregado mensual). '
  'Para day-level se requiere push de account.move.line en qb19 (Fase 2).';

-- ───────────────────────────────────────────────────────────────
-- refresh_cashflow_profiles()
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refresh_cashflow_profiles()
RETURNS TABLE(view_name text, row_count bigint, refreshed_at timestamptz)
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY partner_payment_profile;
  REFRESH MATERIALIZED VIEW CONCURRENTLY journal_flow_profile;
  REFRESH MATERIALIZED VIEW CONCURRENTLY account_payment_profile;

  RETURN QUERY
  SELECT 'partner_payment_profile'::text, COUNT(*)::bigint, NOW() FROM partner_payment_profile
  UNION ALL
  SELECT 'journal_flow_profile'::text,    COUNT(*)::bigint, NOW() FROM journal_flow_profile
  UNION ALL
  SELECT 'account_payment_profile'::text, COUNT(*)::bigint, NOW() FROM account_payment_profile;
END;
$$;

COMMENT ON FUNCTION refresh_cashflow_profiles IS
  'Refresca las 3 materialized views de cashflow profiles. Llamar desde cron semanal.';
