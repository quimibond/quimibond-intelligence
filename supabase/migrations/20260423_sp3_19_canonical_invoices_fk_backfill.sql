BEGIN;

-- 19a. RENAME columns (cheap)
ALTER TABLE canonical_invoices RENAME COLUMN emisor_company_id TO emisor_canonical_company_id;
ALTER TABLE canonical_invoices RENAME COLUMN receptor_company_id TO receptor_canonical_company_id;

-- 19b. Remap Odoo-origin rows only (has_odoo_record=true)
-- These rows still hold companies.id values; map to canonical_companies.id via canonical_name join.
WITH company_map AS (
  SELECT c.id AS old_id, cc.id AS new_id
  FROM companies c
  JOIN canonical_companies cc ON cc.canonical_name = c.canonical_name
)
UPDATE canonical_invoices ci
SET emisor_canonical_company_id = cm.new_id
FROM company_map cm
WHERE ci.has_odoo_record = true
  AND ci.emisor_canonical_company_id = cm.old_id;

WITH company_map AS (
  SELECT c.id AS old_id, cc.id AS new_id
  FROM companies c
  JOIN canonical_companies cc ON cc.canonical_name = c.canonical_name
)
UPDATE canonical_invoices ci
SET receptor_canonical_company_id = cm.new_id
FROM company_map cm
WHERE ci.has_odoo_record = true
  AND ci.receptor_canonical_company_id = cm.old_id;

-- 19c. Residual NULL resolve via matcher_company (only if rfc is known)
UPDATE canonical_invoices ci
SET emisor_canonical_company_id = matcher_company(ci.emisor_rfc, ci.emisor_nombre, NULL, false)
WHERE ci.emisor_canonical_company_id IS NULL AND ci.emisor_rfc IS NOT NULL;

UPDATE canonical_invoices ci
SET receptor_canonical_company_id = matcher_company(ci.receptor_rfc, ci.receptor_nombre, NULL, false)
WHERE ci.receptor_canonical_company_id IS NULL AND ci.receptor_rfc IS NOT NULL;

-- 19d. Salesperson_contact_id via odoo_user_id
UPDATE canonical_invoices ci
SET salesperson_contact_id = cct.id
FROM canonical_contacts cct
WHERE cct.odoo_user_id = ci.salesperson_user_id
  AND ci.salesperson_contact_id IS NULL;

-- 19e. Update matcher functions to use new column names
CREATE OR REPLACE FUNCTION matcher_invoice_quick(p_uuid text) RETURNS void AS $$
DECLARE v_emisor_cc bigint; v_receptor_cc bigint; v_salesperson bigint;
BEGIN
  SELECT matcher_company(ci.emisor_rfc, ci.emisor_nombre, NULL, false) INTO v_emisor_cc
    FROM canonical_invoices ci WHERE ci.sat_uuid = p_uuid LIMIT 1;
  SELECT matcher_company(ci.receptor_rfc, ci.receptor_nombre, NULL, false) INTO v_receptor_cc
    FROM canonical_invoices ci WHERE ci.sat_uuid = p_uuid LIMIT 1;
  SELECT cct.id INTO v_salesperson
    FROM canonical_invoices ci
    JOIN canonical_contacts cct ON cct.odoo_user_id = ci.salesperson_user_id
    WHERE ci.sat_uuid = p_uuid LIMIT 1;

  UPDATE canonical_invoices
  SET emisor_canonical_company_id = COALESCE(v_emisor_cc, emisor_canonical_company_id),
      receptor_canonical_company_id = COALESCE(v_receptor_cc, receptor_canonical_company_id),
      salesperson_contact_id = COALESCE(v_salesperson, salesperson_contact_id),
      last_reconciled_at = now()
  WHERE sat_uuid = p_uuid;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION matcher_all_pending() RETURNS TABLE(
  entity text, attempted integer, resolved integer
) AS $$
DECLARE v_att integer; v_res integer;
BEGIN
  SELECT COUNT(*) INTO v_att FROM canonical_companies
    WHERE needs_review=true OR last_matched_at < (now() - interval '2 hours');
  UPDATE canonical_companies cc SET last_matched_at = now()
  WHERE cc.needs_review=true OR cc.last_matched_at < (now() - interval '2 hours');
  v_res := v_att;
  entity := 'company'; attempted := v_att; resolved := v_res; RETURN NEXT;

  SELECT COUNT(*) INTO v_att FROM canonical_contacts
    WHERE needs_review=true OR last_matched_at < (now() - interval '2 hours');
  UPDATE canonical_contacts cct
  SET canonical_company_id = COALESCE(cct.canonical_company_id, matcher_company(NULL, NULL, SPLIT_PART(cct.primary_email, '@', 2), false)),
      last_matched_at = now()
  WHERE cct.needs_review=true OR cct.last_matched_at < (now() - interval '2 hours');
  v_res := v_att;
  entity := 'contact'; attempted := v_att; resolved := v_res; RETURN NEXT;

  SELECT COUNT(*) INTO v_att FROM canonical_invoices
    WHERE (emisor_canonical_company_id IS NULL AND emisor_rfc IS NOT NULL)
       OR (receptor_canonical_company_id IS NULL AND receptor_rfc IS NOT NULL);
  UPDATE canonical_invoices ci
  SET emisor_canonical_company_id = COALESCE(ci.emisor_canonical_company_id, matcher_company(ci.emisor_rfc, ci.emisor_nombre, NULL, false)),
      receptor_canonical_company_id = COALESCE(ci.receptor_canonical_company_id, matcher_company(ci.receptor_rfc, ci.receptor_nombre, NULL, false)),
      last_reconciled_at = now()
  WHERE (ci.emisor_canonical_company_id IS NULL AND ci.emisor_rfc IS NOT NULL)
     OR (ci.receptor_canonical_company_id IS NULL AND ci.receptor_rfc IS NOT NULL);
  v_res := v_att;
  entity := 'invoice'; attempted := v_att; resolved := v_res; RETURN NEXT;

  RETURN;
END;
$$ LANGUAGE plpgsql;

-- 19f. ADD CONSTRAINT NOT VALID + VALIDATE (avoids full write lock)
ALTER TABLE canonical_invoices
  ADD CONSTRAINT fk_ci_emisor   FOREIGN KEY (emisor_canonical_company_id)   REFERENCES canonical_companies(id) NOT VALID;
ALTER TABLE canonical_invoices
  ADD CONSTRAINT fk_ci_receptor FOREIGN KEY (receptor_canonical_company_id) REFERENCES canonical_companies(id) NOT VALID;
ALTER TABLE canonical_invoices
  ADD CONSTRAINT fk_ci_sp       FOREIGN KEY (salesperson_contact_id)       REFERENCES canonical_contacts(id)  NOT VALID;

ALTER TABLE canonical_invoices VALIDATE CONSTRAINT fk_ci_emisor;
ALTER TABLE canonical_invoices VALIDATE CONSTRAINT fk_ci_receptor;
ALTER TABLE canonical_invoices VALIDATE CONSTRAINT fk_ci_sp;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('alter_table','canonical_invoices','SP3 Task 19: FK rename + backfill (has_odoo_record=true only) + matcher updates + ADD CONSTRAINT','20260423_sp3_19_canonical_invoices_fk_backfill.sql','silver-sp3',true);

COMMIT;
