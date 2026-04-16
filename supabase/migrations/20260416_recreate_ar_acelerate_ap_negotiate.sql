-- ============================================================================
-- Migration 20260416: Recrear cashflow_ar_acelerate y cashflow_ap_negotiate
--
-- Audit 2026-04-16: Estos dos views se perdieron por un DROP MATERIALIZED
-- VIEW partner_payment_profile CASCADE ejecutado durante el fix de profiles
-- (20260416_journal_and_partner_profile_fx_fix.sql). Aparentemente fueron
-- creados ad-hoc via dashboard (NO están en ninguna migration de git —
-- confirmado por ausencia en grep + en schema_changes).
--
-- Consumidos por get_cashflow_recommendations() que alimenta la UI de
-- /finanzas sección "Recomendaciones del director financiero".
--
-- Reconstrucción basada en:
--   - Columnas del JSON que emitía la RPC (company_id, company_name,
--     n_invoices, avg_days_overdue, max_days_overdue, total_overdue_mxn,
--     collection_probability_14d, expected_collection_14d_mxn, avg_confidence)
--   - cashflow_ar_predicted (v3, per-invoice con residual_mxn + confidence)
--   - companies (canonical_name)
--
-- collection_probability_14d: heurística por antigüedad del vencimiento:
--   0.70 → <= 30 días vencidos (tracking activo)
--   0.45 → 31-60 días (cobranza con esfuerzo)
--   0.15 → 61-180 días (probable refinanciamiento)
--   0.05 → > 180 días (write-off candidate)
--
-- expected_collection_14d_mxn = total_overdue_mxn × collection_probability_14d
-- ============================================================================

DROP VIEW IF EXISTS cashflow_ar_acelerate CASCADE;
DROP VIEW IF EXISTS cashflow_ap_negotiate CASCADE;


-- ═══════════════════════════════════════════════════════════════
-- VIEW: cashflow_ar_acelerate
-- Agrega AR vencida por empresa con probabilidad de cobro a 14 días.
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW cashflow_ar_acelerate AS
WITH open_overdue AS (
  SELECT
    i.company_id,
    i.odoo_partner_id,
    COALESCE(i.days_overdue, 0)                              AS days_overdue,
    COALESCE(i.amount_residual_mxn, i.amount_residual, 0)::numeric AS residual_mxn
  FROM odoo_invoices i
  WHERE i.move_type = 'out_invoice'
    AND i.state = 'posted'
    AND i.payment_state IN ('not_paid', 'partial')
    AND COALESCE(i.amount_residual_mxn, i.amount_residual, 0) > 0
    AND COALESCE(i.days_overdue, 0) > 0
),
per_company AS (
  SELECT
    o.company_id,
    COUNT(*)                                                 AS n_invoices,
    SUM(o.residual_mxn)                                      AS total_overdue_mxn,
    AVG(o.days_overdue)::int                                 AS avg_days_overdue,
    MAX(o.days_overdue)                                      AS max_days_overdue,
    -- Weighted average confidence del partner profile (inbound). Fallback a 0.5.
    COALESCE(AVG(pp.confidence), 0.50)::numeric              AS avg_confidence,
    -- Probabilidad de cobro a 14d por buckets de aging.
    CASE
      WHEN MAX(o.days_overdue) > 180 THEN 0.05
      WHEN MAX(o.days_overdue) > 60  THEN 0.15
      WHEN MAX(o.days_overdue) > 30  THEN 0.45
      ELSE 0.70
    END::numeric                                             AS collection_probability_14d
  FROM open_overdue o
  LEFT JOIN partner_payment_profile pp
    ON pp.odoo_partner_id = o.odoo_partner_id
   AND pp.payment_type = 'inbound'
  WHERE o.company_id IS NOT NULL
  GROUP BY o.company_id
)
SELECT
  pc.company_id,
  c.canonical_name                                           AS company_name,
  pc.n_invoices,
  ROUND(pc.total_overdue_mxn, 2)                             AS total_overdue_mxn,
  pc.avg_days_overdue,
  pc.max_days_overdue,
  ROUND(pc.avg_confidence, 3)                                AS avg_confidence,
  pc.collection_probability_14d,
  ROUND(pc.total_overdue_mxn * pc.collection_probability_14d, 2)
                                                             AS expected_collection_14d_mxn
FROM per_company pc
LEFT JOIN companies c ON c.id = pc.company_id
ORDER BY pc.total_overdue_mxn DESC;

COMMENT ON VIEW cashflow_ar_acelerate IS
  'AR vencida agregada por empresa. Probabilidad de cobro a 14d por buckets de aging (>180d=0.05, >60d=0.15, >30d=0.45, ≤30d=0.70). Reconstruida 2026-04-16 después de CASCADE accidental.';


-- ═══════════════════════════════════════════════════════════════
-- VIEW: cashflow_ap_negotiate
-- Agrega AP vencida por proveedor (sin probabilidad — es decisión nuestra).
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW cashflow_ap_negotiate AS
WITH open_overdue AS (
  SELECT
    i.company_id,
    i.odoo_partner_id,
    COALESCE(i.days_overdue, 0)                              AS days_overdue,
    COALESCE(i.amount_residual_mxn, i.amount_residual, 0)::numeric AS residual_mxn
  FROM odoo_invoices i
  WHERE i.move_type = 'in_invoice'
    AND i.state = 'posted'
    AND i.payment_state IN ('not_paid', 'partial')
    AND COALESCE(i.amount_residual_mxn, i.amount_residual, 0) > 0
    AND COALESCE(i.days_overdue, 0) > 0
),
per_company AS (
  SELECT
    o.company_id,
    COUNT(*)                                                 AS n_invoices,
    SUM(o.residual_mxn)                                      AS total_overdue_mxn,
    AVG(o.days_overdue)::int                                 AS avg_days_overdue,
    MAX(o.days_overdue)                                      AS max_days_overdue,
    COALESCE(AVG(pp.confidence), 0.50)::numeric              AS avg_confidence
  FROM open_overdue o
  LEFT JOIN partner_payment_profile pp
    ON pp.odoo_partner_id = o.odoo_partner_id
   AND pp.payment_type = 'outbound'
  WHERE o.company_id IS NOT NULL
  GROUP BY o.company_id
)
SELECT
  pc.company_id,
  c.canonical_name                                           AS company_name,
  pc.n_invoices,
  ROUND(pc.total_overdue_mxn, 2)                             AS total_overdue_mxn,
  pc.avg_days_overdue,
  pc.max_days_overdue,
  ROUND(pc.avg_confidence, 3)                                AS avg_confidence
FROM per_company pc
LEFT JOIN companies c ON c.id = pc.company_id
ORDER BY pc.total_overdue_mxn DESC;

COMMENT ON VIEW cashflow_ap_negotiate IS
  'AP vencida agregada por proveedor (sin probabilidad — decisión nuestra de pagar). Reconstruida 2026-04-16 después de CASCADE accidental.';


GRANT SELECT ON cashflow_ar_acelerate  TO anon, authenticated, service_role;
GRANT SELECT ON cashflow_ap_negotiate  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
