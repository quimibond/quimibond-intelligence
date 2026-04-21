-- SP3 Task 20: canonical_payments + canonical_credit_notes FK rename + backfill
-- Renames counterparty_company_id → counterparty_canonical_company_id on canonical_payments,
-- and emisor_company_id / receptor_company_id → *_canonical_* on canonical_credit_notes.
-- Remaps Odoo-origin values from companies.id space → canonical_companies.id space.
-- Resolves SAT-only rows via matcher_company() on counterparty RFCs.
-- Adds validated FK constraints to canonical_companies on all three columns.

BEGIN;

-- canonical_payments
ALTER TABLE canonical_payments RENAME COLUMN counterparty_company_id TO counterparty_canonical_company_id;

WITH company_map AS (
  SELECT c.id AS old_id, cc.id AS new_id
  FROM companies c JOIN canonical_companies cc ON cc.canonical_name = c.canonical_name
)
UPDATE canonical_payments cp
SET counterparty_canonical_company_id = cm.new_id
FROM company_map cm
WHERE cp.has_odoo_record = true
  AND cp.counterparty_canonical_company_id = cm.old_id;

-- For SAT-only canonical_payments, resolve via rfc_emisor_cta_ord/ben (SAT counterparty RFCs)
-- These didn't get Task 17 treatment. Use matcher_company on the most reliable RFC (receiver side).
UPDATE canonical_payments cp
SET counterparty_canonical_company_id = COALESCE(
  cp.counterparty_canonical_company_id,
  matcher_company(cp.rfc_emisor_cta_ord, NULL, NULL, false),
  matcher_company(cp.rfc_emisor_cta_ben, NULL, NULL, false)
)
WHERE cp.counterparty_canonical_company_id IS NULL
  AND (cp.rfc_emisor_cta_ord IS NOT NULL OR cp.rfc_emisor_cta_ben IS NOT NULL);

-- Orphan nullify before VALIDATE (any stale value not in canonical_companies)
UPDATE canonical_payments SET counterparty_canonical_company_id = NULL
WHERE counterparty_canonical_company_id IS NOT NULL
  AND counterparty_canonical_company_id NOT IN (SELECT id FROM canonical_companies);

ALTER TABLE canonical_payments
  ADD CONSTRAINT fk_cp_counterparty FOREIGN KEY (counterparty_canonical_company_id) REFERENCES canonical_companies(id) NOT VALID;
ALTER TABLE canonical_payments VALIDATE CONSTRAINT fk_cp_counterparty;

-- canonical_credit_notes
ALTER TABLE canonical_credit_notes RENAME COLUMN emisor_company_id TO emisor_canonical_company_id;
ALTER TABLE canonical_credit_notes RENAME COLUMN receptor_company_id TO receptor_canonical_company_id;

WITH company_map AS (
  SELECT c.id AS old_id, cc.id AS new_id
  FROM companies c JOIN canonical_companies cc ON cc.canonical_name = c.canonical_name
)
UPDATE canonical_credit_notes ccn
SET emisor_canonical_company_id = cm.new_id
FROM company_map cm
WHERE ccn.has_odoo_record = true
  AND ccn.emisor_canonical_company_id = cm.old_id;

WITH company_map AS (
  SELECT c.id AS old_id, cc.id AS new_id
  FROM companies c JOIN canonical_companies cc ON cc.canonical_name = c.canonical_name
)
UPDATE canonical_credit_notes ccn
SET receptor_canonical_company_id = cm.new_id
FROM company_map cm
WHERE ccn.has_odoo_record = true
  AND ccn.receptor_canonical_company_id = cm.old_id;

-- SAT-side resolution via emisor_rfc / receptor_rfc + matcher_company
UPDATE canonical_credit_notes ccn
SET emisor_canonical_company_id = matcher_company(ccn.emisor_rfc, ccn.emisor_nombre, NULL, false)
WHERE ccn.emisor_canonical_company_id IS NULL AND ccn.emisor_rfc IS NOT NULL;

UPDATE canonical_credit_notes ccn
SET receptor_canonical_company_id = matcher_company(ccn.receptor_rfc, ccn.receptor_nombre, NULL, false)
WHERE ccn.receptor_canonical_company_id IS NULL AND ccn.receptor_rfc IS NOT NULL;

-- Orphan nullify
UPDATE canonical_credit_notes SET emisor_canonical_company_id = NULL
WHERE emisor_canonical_company_id IS NOT NULL
  AND emisor_canonical_company_id NOT IN (SELECT id FROM canonical_companies);

UPDATE canonical_credit_notes SET receptor_canonical_company_id = NULL
WHERE receptor_canonical_company_id IS NOT NULL
  AND receptor_canonical_company_id NOT IN (SELECT id FROM canonical_companies);

ALTER TABLE canonical_credit_notes
  ADD CONSTRAINT fk_ccn_emisor   FOREIGN KEY (emisor_canonical_company_id)   REFERENCES canonical_companies(id) NOT VALID;
ALTER TABLE canonical_credit_notes
  ADD CONSTRAINT fk_ccn_receptor FOREIGN KEY (receptor_canonical_company_id) REFERENCES canonical_companies(id) NOT VALID;
ALTER TABLE canonical_credit_notes VALIDATE CONSTRAINT fk_ccn_emisor;
ALTER TABLE canonical_credit_notes VALIDATE CONSTRAINT fk_ccn_receptor;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('alter_table','canonical_payments,canonical_credit_notes','SP3 Task 20: FK rename + backfill + constraints','20260423_sp3_20_canonical_payments_ccn_fk_backfill.sql','silver-sp3',true);

COMMIT;
