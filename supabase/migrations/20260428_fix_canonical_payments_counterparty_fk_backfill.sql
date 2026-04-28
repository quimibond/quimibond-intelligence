-- 20260428_fix_canonical_payments_counterparty_fk_backfill.sql
-- ─────────────────────────────────────────────────────────────────────────
-- BUG #2: canonical_payments.counterparty_canonical_company_id stale.
--
-- 31 canonical_payments tienen un counterparty FK que apunta al canonical
-- WRONG según el odoo_partner_id actual. Total $2.44M MXN afectado.
--
-- El fix de SHAWMUT (commit 1df34b1) backfilleó canonical_invoices pero NO
-- propagó al canonical_payments. El mismo patrón aplica:
--   canonical_payments.odoo_partner_id (estable, viene del Odoo move_id)
--   ↓ JOIN
--   canonical_companies.odoo_partner_id (post-MDM, único)
--   ↓
--   canonical_companies.id (FK que counterparty_canonical_company_id debería apuntar)
--
-- Sample:
--   pay_id=561035 partner=9038 mxn=$-70,227
--     current: id=825 (Jose J. Mizrahi)        ← stale (entidad merged)
--     should:  id=133797 (Jose Jaime Mizrahi Tuachi)  ← actual canonical
--
-- 8 de los 31 stale apuntan al mismo merge (id=825 → id=133797), sugiriendo
-- que un mdm_merge_companies() previo no propagó al canonical_payments.
--
-- BLAST RADIUS: cobranza/payments dashboards que agregan por
-- counterparty_canonical_company_id reportan totales en la wrong entity.
-- Particularmente afectada la auditoría de pagos a partes relacionadas
-- (is_related_party=true en MITJ991130TV7).
--
-- IDEMPOTENCIA: UPDATE WHERE distinto, no re-corre si no hay drift.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Pre-validation: count rows that will change ─────────────────────────
DO $$
DECLARE v_count int;
        v_value numeric;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(cp.amount_mxn_resolved), 0) INTO v_count, v_value
  FROM canonical_payments cp
  JOIN canonical_companies cc ON cc.odoo_partner_id = cp.odoo_partner_id
  WHERE cp.odoo_partner_id IS NOT NULL
    AND cp.counterparty_canonical_company_id IS DISTINCT FROM cc.id;
  RAISE NOTICE 'canonical_payments stale FKs: % rows, $% MXN', v_count, v_value;
END $$;

-- ── Backfill counterparty_canonical_company_id ─────────────────────────
WITH fix AS (
  SELECT
    cp.canonical_id,
    cc.id AS correct_canonical_company_id
  FROM canonical_payments cp
  JOIN canonical_companies cc ON cc.odoo_partner_id = cp.odoo_partner_id
  WHERE cp.odoo_partner_id IS NOT NULL
    AND cp.counterparty_canonical_company_id IS DISTINCT FROM cc.id
)
UPDATE canonical_payments cp
SET counterparty_canonical_company_id = fix.correct_canonical_company_id,
    last_reconciled_at = now()
FROM fix
WHERE cp.canonical_id = fix.canonical_id;

-- ── Post-validation ────────────────────────────────────────────────────
DO $$
DECLARE v_remaining int;
BEGIN
  SELECT COUNT(*) INTO v_remaining
  FROM canonical_payments cp
  JOIN canonical_companies cc ON cc.odoo_partner_id = cp.odoo_partner_id
  WHERE cp.odoo_partner_id IS NOT NULL
    AND cp.counterparty_canonical_company_id IS DISTINCT FROM cc.id;
  RAISE NOTICE 'Post-fix remaining stale: % rows (should be 0)', v_remaining;
  IF v_remaining > 0 THEN
    RAISE WARNING 'Backfill INCOMPLETE — % rows still stale. Investigate.', v_remaining;
  END IF;
END $$;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES (
  'data_fix', 'canonical_payments',
  'Backfill counterparty_canonical_company_id via odoo_partner_id JOIN canonical_companies. ~31 rows / $2.44M MXN affected. Same pattern as canonical_invoices SHAWMUT fix.',
  '20260428_fix_canonical_payments_counterparty_fk_backfill.sql', 'audit-mdm-cleanup', true
);

COMMIT;
