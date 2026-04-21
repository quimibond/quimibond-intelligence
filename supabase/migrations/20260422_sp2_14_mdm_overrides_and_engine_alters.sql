BEGIN;

-- ====================================================================
-- 14a. mdm_manual_overrides unified table
-- ====================================================================
CREATE TABLE IF NOT EXISTS mdm_manual_overrides (
  id bigserial PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('invoice','payment','product','company','contact')),
  canonical_id text NOT NULL,
  override_field text NOT NULL,
  override_value text NOT NULL,
  override_source text NOT NULL DEFAULT 'manual',
  linked_by text,
  linked_at timestamptz NOT NULL DEFAULT now(),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_mmo_entity ON mdm_manual_overrides (entity_type, canonical_id);
CREATE INDEX IF NOT EXISTS ix_mmo_field ON mdm_manual_overrides (override_field);

-- ====================================================================
-- 14b. Migrate invoice_bridge_manual (idempotent)
-- ====================================================================
INSERT INTO mdm_manual_overrides (entity_type, canonical_id, override_field, override_value, linked_by, linked_at, note)
SELECT 'invoice',
       COALESCE(ci.canonical_id, 'odoo:' || ibm.odoo_invoice_id::text),
       'sat_uuid', ibm.syntage_uuid, ibm.linked_by, ibm.linked_at, ibm.note
FROM invoice_bridge_manual ibm
LEFT JOIN canonical_invoices ci ON ci.odoo_invoice_id = ibm.odoo_invoice_id
WHERE NOT EXISTS (
  SELECT 1 FROM mdm_manual_overrides mmo
  WHERE mmo.entity_type='invoice' AND mmo.override_field='sat_uuid' AND mmo.override_value=ibm.syntage_uuid
);

-- ====================================================================
-- 14c. Migrate payment_bridge_manual (idempotent)
-- ====================================================================
INSERT INTO mdm_manual_overrides (entity_type, canonical_id, override_field, override_value, linked_by, linked_at, note)
SELECT 'payment',
       COALESCE(cp.canonical_id, 'odoo:' || pbm.odoo_payment_id::text),
       'sat_uuid_complemento', pbm.syntage_complemento_uuid, pbm.linked_by, pbm.linked_at, pbm.note
FROM payment_bridge_manual pbm
LEFT JOIN canonical_payments cp ON cp.odoo_payment_id = pbm.odoo_payment_id
WHERE NOT EXISTS (
  SELECT 1 FROM mdm_manual_overrides mmo
  WHERE mmo.entity_type='payment' AND mmo.override_field='sat_uuid_complemento' AND mmo.override_value=pbm.syntage_complemento_uuid
);

-- ====================================================================
-- 14d. Migrate products_fiscal_map (idempotent)
-- ====================================================================
INSERT INTO mdm_manual_overrides (entity_type, canonical_id, override_field, override_value, linked_by, linked_at, note)
SELECT 'product',
       'odoo:' || pfm.odoo_product_id::text,
       'sat_clave_prod_serv', pfm.sat_clave_prod_serv, pfm.created_by, pfm.created_at, pfm.note
FROM products_fiscal_map pfm
WHERE NOT EXISTS (
  SELECT 1 FROM mdm_manual_overrides mmo
  WHERE mmo.entity_type='product' AND mmo.override_field='sat_clave_prod_serv'
    AND mmo.canonical_id='odoo:' || pfm.odoo_product_id::text
);

-- ====================================================================
-- 14e. Apply manual overrides to canonical tables (no-op today; bridges mostly empty)
-- ====================================================================
UPDATE canonical_invoices ci
SET sat_uuid = mmo.override_value,
    has_manual_link = true,
    resolved_from = 'manual_bridge',
    match_confidence = 'exact'
FROM mdm_manual_overrides mmo
WHERE mmo.entity_type='invoice' AND mmo.override_field='sat_uuid'
  AND ci.canonical_id = mmo.canonical_id
  AND ci.sat_uuid IS NULL;

UPDATE canonical_payments cp
SET sat_uuid_complemento = mmo.override_value,
    has_manual_link = true
FROM mdm_manual_overrides mmo
WHERE mmo.entity_type='payment' AND mmo.override_field='sat_uuid_complemento'
  AND cp.canonical_id = mmo.canonical_id
  AND cp.sat_uuid_complemento IS NULL;

-- ====================================================================
-- 14f. Extend audit_tolerances per §9.1
-- ====================================================================
ALTER TABLE audit_tolerances ADD COLUMN IF NOT EXISTS severity_default text DEFAULT 'medium'
  CHECK (severity_default IN ('low','medium','high','critical'));
ALTER TABLE audit_tolerances ADD COLUMN IF NOT EXISTS entity text;
ALTER TABLE audit_tolerances ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT true;
ALTER TABLE audit_tolerances ADD COLUMN IF NOT EXISTS auto_resolve boolean DEFAULT false;
ALTER TABLE audit_tolerances ADD COLUMN IF NOT EXISTS check_cadence text DEFAULT 'hourly'
  CHECK (check_cadence IN ('on_insert','hourly','2h','daily'));

-- ====================================================================
-- 14g. Extend reconciliation_issues per §9.1 (80k rows)
-- age_days as regular column + trigger (avoid GENERATED STORED rewrite)
-- ====================================================================
ALTER TABLE reconciliation_issues ADD COLUMN IF NOT EXISTS canonical_entity_type text;
ALTER TABLE reconciliation_issues ADD COLUMN IF NOT EXISTS canonical_entity_id text;
ALTER TABLE reconciliation_issues ADD COLUMN IF NOT EXISTS impact_mxn numeric(14,2);
ALTER TABLE reconciliation_issues ADD COLUMN IF NOT EXISTS age_days integer;
ALTER TABLE reconciliation_issues ADD COLUMN IF NOT EXISTS priority_score numeric(10,4);
ALTER TABLE reconciliation_issues ADD COLUMN IF NOT EXISTS assignee_canonical_contact_id bigint;
ALTER TABLE reconciliation_issues ADD COLUMN IF NOT EXISTS action_cta text;
ALTER TABLE reconciliation_issues ADD COLUMN IF NOT EXISTS invariant_key text;

CREATE OR REPLACE FUNCTION trg_reconciliation_issues_age() RETURNS trigger AS $$
BEGIN
  NEW.age_days := EXTRACT(DAY FROM now() - NEW.detected_at)::integer;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ri_age ON reconciliation_issues;
CREATE TRIGGER trg_ri_age BEFORE INSERT OR UPDATE ON reconciliation_issues
  FOR EACH ROW EXECUTE FUNCTION trg_reconciliation_issues_age();

-- Backfill age_days on existing 80k rows
UPDATE reconciliation_issues
SET age_days = EXTRACT(DAY FROM now() - detected_at)::integer
WHERE age_days IS NULL;

-- ====================================================================
-- 14h. Indexes for Task 15 runner queries
-- ====================================================================
CREATE INDEX IF NOT EXISTS ix_ri_priority
  ON reconciliation_issues (priority_score DESC) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ri_invariant
  ON reconciliation_issues (invariant_key);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('alter_table','reconciliation_issues,audit_tolerances,mdm_manual_overrides',
  'SP2 Task 14: mdm_manual_overrides unified + engine ALTER TABLEs (§9.1) + age_days trigger + backfill',
  '20260422_sp2_14_mdm_overrides_and_engine_alters.sql','silver-sp2',true);

COMMIT;
