-- Resolver counterparty NULL para canonical_payments que son internal a Quimibond.
--
-- Contexto: 1,326 canonical_payments tenían counterparty_canonical_company_id=NULL.
-- Análisis revela 3 buckets:
--   A) odoo_partner_id=1 (Quimibond default partner en Odoo): 1,247 rows. Son
--      transferencias entre cuentas propias (BBVA, MIFEL, etc.), ajustes y
--      operaciones internas. counterparty correcto = Quimibond mismo (id=868).
--   B) Payroll batches con journal_name='Salarios': 14 rows. Operaciones de RH
--      desde la perspectiva de la empresa; counterparty agregado = Quimibond.
--   C) Supplier real sin shadow canonicalizada: 3 rows (partner_ids 3516, 5440,
--      10546-when-BBVA). Estos quedan NULL hasta que aparezcan como invoice
--      counterparty (matcher_company los recogerá via res.partner sync).
--
-- Esta migration resuelve A+B (1,261 rows) y deja C + 19 odoo-sin-partner + 43
-- sat-only-sin-RFC-match para fases posteriores.

BEGIN;

-- A) partner_id=1 → Quimibond auto-self
WITH a_rows AS (
  UPDATE canonical_payments
  SET counterparty_canonical_company_id = 868
  WHERE counterparty_canonical_company_id IS NULL
    AND sources_present = ARRAY['odoo']::text[]
    AND odoo_partner_id = 1
  RETURNING canonical_id
)
SELECT COUNT(*) AS bucket_a_resolved FROM a_rows;

-- B) Salarios journal → Quimibond auto (perspectiva agregada de payroll)
WITH b_rows AS (
  UPDATE canonical_payments cp
  SET counterparty_canonical_company_id = 868
  WHERE cp.counterparty_canonical_company_id IS NULL
    AND cp.sources_present = ARRAY['odoo']::text[]
    AND cp.odoo_partner_id IS NOT NULL
    AND cp.odoo_partner_id <> 1
    AND EXISTS (
      SELECT 1 FROM odoo_account_payments oap
      WHERE oap.odoo_partner_id = cp.odoo_partner_id
        AND oap.journal_name = 'Salarios'
    )
  RETURNING canonical_id
)
SELECT COUNT(*) AS bucket_b_resolved FROM b_rows;

-- Audit log
INSERT INTO pipeline_logs (level, phase, message, details)
VALUES (
  'info',
  'resolve_canonical_payments_internal_counterparty',
  'Resolved 1,261 canonical_payments NULL counterparty to Quimibond (id=868) for partner_id=1 internal + Salarios payroll',
  jsonb_build_object(
    'bucket_a_partner_id_1', 1247,
    'bucket_b_salarios_payroll', 14,
    'pending_bucket_c_external_suppliers', 3,
    'pending_odoo_no_partner_id', 19,
    'pending_sat_only_no_rfc_match', 43,
    'quimibond_canonical_company_id', 868,
    'reversible', true
  )
);

COMMIT;
