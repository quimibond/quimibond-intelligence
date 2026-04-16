-- ============================================================================
-- Migration 20260416: FX/partner fixes para cashflow_profiles v3
--
-- Dos fixes en los matviews de profiles:
--
-- 1. USO DE `amount` (nativo) VS `amount_signed` (MXN canónico)
--    odoo_account_payments.amount está en la moneda nativa del journal
--    (USD para journals USD, MXN para MXN). SUM(amount) sobre journals
--    mixtos produce cifras sin sentido (p.ej. 70,000 USD + 15,000 MXN = 85,000
--    como si fueran la misma unidad). amount_signed SIEMPRE está en MXN
--    (company currency) y con signo por dirección: + inbound, - outbound.
--
--    FIX: usar ABS(amount_signed) en todos los matviews.
--
-- 2. PARTNER_ID = 1 (admin interno de Odoo) aparecía como top-1 inbound Y
--    outbound de partner_payment_profile. Se contamina por asientos
--    administrativos (transferencias internas, ajustes contables, etc.).
--
--    FIX: filtrar odoo_partner_id > 1 AND invoice_count_24m > 0 para exigir
--    que sea un partner real con facturación.
--
-- Después del fix:
--   - partner_payment_profile: top-1 inbound pasa de "partner_id=1 33.8M" a
--     clientes reales (mayor: 1728 con 16.2M y 138 facturas).
--   - journal_flow_profile: cifras en MXN consistentes con cfo_dashboard.
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════
-- 1. partner_payment_profile (recreate con filtros de calidad)
-- ═══════════════════════════════════════════════════════════════

DROP MATERIALIZED VIEW IF EXISTS partner_payment_profile CASCADE;

CREATE MATERIALIZED VIEW partner_payment_profile AS
WITH payments_24m AS (
  SELECT
    p.odoo_partner_id,
    p.payment_type,
    p.journal_name,
    p.payment_method,
    ABS(p.amount_signed)::numeric              AS amount_mxn,
    p.date,
    to_char(p.date, 'YYYY-MM')                 AS period,
    EXTRACT(DAY  FROM p.date)::int             AS day_of_month,
    EXTRACT(DOW  FROM p.date)::int             AS day_of_week
  FROM odoo_account_payments p
  WHERE p.date >= CURRENT_DATE - INTERVAL '24 months'
    AND p.odoo_partner_id IS NOT NULL
    AND p.odoo_partner_id > 1         -- excluir admin / interno
    AND p.state IN ('paid','in_process')
    AND p.amount_signed IS NOT NULL
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
  WHERE i.invoice_date >= CURRENT_DATE - INTERVAL '24 months'
    AND i.state = 'posted'
    AND i.odoo_partner_id IS NOT NULL
    AND i.odoo_partner_id > 1
    AND i.move_type IN ('out_invoice','out_refund','in_invoice','in_refund')
  GROUP BY i.odoo_partner_id, payment_type
),
pay_stats AS (
  SELECT
    odoo_partner_id,
    payment_type,
    COUNT(*)::int                                                  AS payment_count_24m,
    COUNT(DISTINCT period)::int                                    AS months_active,
    SUM(amount_mxn)::numeric                                       AS total_paid_mxn,
    AVG(amount_mxn)::numeric                                       AS avg_payment_amount,
    MODE() WITHIN GROUP (ORDER BY day_of_month)                    AS typical_day_of_month,
    MODE() WITHIN GROUP (ORDER BY journal_name)                    AS preferred_bank_journal,
    MODE() WITHIN GROUP (ORDER BY payment_method)                  AS preferred_payment_method
  FROM payments_24m
  GROUP BY odoo_partner_id, payment_type
)
SELECT
  COALESCE(p.odoo_partner_id, i.odoo_partner_id)                   AS odoo_partner_id,
  COALESCE(p.payment_type,    i.payment_type)                      AS payment_type,
  COALESCE(p.payment_count_24m, 0)                                 AS payment_count_24m,
  COALESCE(p.months_active, 0)                                     AS months_active,
  COALESCE(p.total_paid_mxn, 0)                                    AS total_paid_mxn,
  COALESCE(p.avg_payment_amount, 0)                                AS avg_payment_amount,
  p.typical_day_of_month                                           AS typical_day_of_month,
  p.preferred_bank_journal                                         AS preferred_bank_journal,
  p.preferred_payment_method                                       AS preferred_payment_method,
  COALESCE(i.invoice_count_24m, 0)                                 AS invoice_count_24m,
  COALESCE(i.paid_count, 0)                                        AS paid_invoice_count,
  i.avg_days_to_pay                                                AS avg_days_to_pay,
  i.median_days_to_pay                                             AS median_days_to_pay,
  i.stddev_days_to_pay                                             AS stddev_days_to_pay,
  COALESCE(i.total_invoiced_mxn, 0)                                AS total_invoiced_mxn,
  COALESCE(i.writeoff_risk_count, 0)                               AS writeoff_risk_count,
  CASE WHEN COALESCE(i.invoice_count_24m, 0) > 0
       THEN ROUND((100.0 * COALESCE(i.writeoff_risk_count, 0) / i.invoice_count_24m)::numeric, 1)
       ELSE 0
  END                                                              AS writeoff_risk_pct,
  -- Confianza: mezcla de tamaño de muestra + estabilidad + paid ratio
  CASE
    WHEN COALESCE(p.payment_count_24m, 0) = 0 AND COALESCE(i.paid_count, 0) = 0 THEN 0.00
    WHEN COALESCE(p.payment_count_24m, 0) >= 12 AND COALESCE(i.paid_count, 0) >= 6 THEN 1.00
    WHEN COALESCE(p.payment_count_24m, 0) >= 6  AND COALESCE(i.paid_count, 0) >= 3 THEN 0.85
    WHEN COALESCE(p.payment_count_24m, 0) >= 3                                     THEN 0.65
    ELSE 0.40
  END::numeric(5,3)                                                AS confidence
FROM pay_stats p
FULL OUTER JOIN invoice_stats i
  USING (odoo_partner_id, payment_type)
-- Exige al menos una factura o un pago — evita rows sólo-ajustes-contables
WHERE COALESCE(i.invoice_count_24m, 0) > 0
   OR COALESCE(p.payment_count_24m, 0) > 0;

CREATE UNIQUE INDEX idx_partner_payment_profile_pk
  ON partner_payment_profile (odoo_partner_id, payment_type);

COMMENT ON MATERIALIZED VIEW partner_payment_profile IS
  'Perfil de pago por partner últimos 24m. Excluye partner_id<=1 (admin). Usa amount_signed (MXN) para totales multi-moneda consistentes.';


-- ═══════════════════════════════════════════════════════════════
-- 2. journal_flow_profile (recreate con amount_signed)
-- ═══════════════════════════════════════════════════════════════

DROP MATERIALIZED VIEW IF EXISTS journal_flow_profile CASCADE;

CREATE MATERIALIZED VIEW journal_flow_profile AS
WITH monthly AS (
  SELECT
    p.journal_name,
    p.payment_type,
    to_char(p.date, 'YYYY-MM')                  AS period,
    SUM(ABS(p.amount_signed))::numeric          AS period_total,
    COUNT(*)                                    AS period_count
  FROM odoo_account_payments p
  WHERE p.date >= CURRENT_DATE - INTERVAL '12 months'
    AND p.state IN ('paid','in_process')
    AND p.amount_signed IS NOT NULL
  GROUP BY p.journal_name, p.payment_type, period
),
top_partners AS (
  SELECT
    p.journal_name,
    p.payment_type,
    p.odoo_partner_id,
    SUM(ABS(p.amount_signed)) AS partner_total,
    ROW_NUMBER() OVER (
      PARTITION BY p.journal_name, p.payment_type
      ORDER BY SUM(ABS(p.amount_signed)) DESC
    ) AS rnk
  FROM odoo_account_payments p
  WHERE p.date >= CURRENT_DATE - INTERVAL '12 months'
    AND p.state IN ('paid','in_process')
    AND p.odoo_partner_id IS NOT NULL
    AND p.odoo_partner_id > 1
    AND p.amount_signed IS NOT NULL
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
  COUNT(DISTINCT m.period)::int                                     AS months_active,
  SUM(m.period_count)::int                                          AS total_payments_12m,
  SUM(m.period_total)::numeric                                      AS total_amount_12m,
  AVG(m.period_total)::numeric                                      AS avg_monthly_amount,
  STDDEV(m.period_total)::numeric                                   AS stddev_monthly_amount,
  CASE WHEN AVG(m.period_total) > 0
       THEN ROUND((STDDEV(m.period_total) / AVG(m.period_total))::numeric, 3)
       ELSE NULL
  END                                                               AS volatility_cv,
  COALESCE(t.top5_partner_ids, ARRAY[]::int[])                      AS top5_partner_ids
FROM monthly m
LEFT JOIN top5 t USING (journal_name, payment_type)
GROUP BY m.journal_name, m.payment_type, t.top5_partner_ids;

CREATE UNIQUE INDEX idx_journal_flow_profile_pk
  ON journal_flow_profile (journal_name, payment_type);

COMMENT ON MATERIALIZED VIEW journal_flow_profile IS
  'Baseline de flujo por journal (banco) últimos 12m, en MXN (amount_signed). top5_partner_ids excluye partner<=1. Volatility_cv = stddev/avg.';


-- ═══════════════════════════════════════════════════════════════
-- Refresh inicial (idempotente: si ya existen datos, los actualiza)
-- ═══════════════════════════════════════════════════════════════
DO $$
BEGIN
  REFRESH MATERIALIZED VIEW partner_payment_profile;
  REFRESH MATERIALIZED VIEW journal_flow_profile;
EXCEPTION WHEN OTHERS THEN
  -- Si los matviews están vacíos por algún motivo (p.ej. primera aplicación
  -- sin datos), dejamos que el primer refresh del cron los pueble.
  RAISE NOTICE 'refresh_matviews: %', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
