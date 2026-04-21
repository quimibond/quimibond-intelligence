BEGIN;

CREATE OR REPLACE FUNCTION canonical_contacts_upsert_from_user() RETURNS trigger AS $$
BEGIN
  IF NEW.email IS NULL OR NEW.email = '' THEN RETURN NEW; END IF;
  INSERT INTO canonical_contacts (primary_email, display_name, canonical_name, odoo_user_id, contact_type, match_method, match_confidence, last_matched_at)
  VALUES (LOWER(NEW.email), NEW.name, LOWER(NEW.name), NEW.odoo_user_id, 'internal_user', 'email_exact', 0.99, now())
  ON CONFLICT ((LOWER(primary_email))) DO UPDATE SET
    odoo_user_id = EXCLUDED.odoo_user_id,
    display_name = COALESCE(canonical_contacts.display_name, EXCLUDED.display_name),
    last_matched_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION canonical_contacts_upsert_from_employee() RETURNS trigger AS $$
BEGIN
  IF NEW.work_email IS NULL OR NEW.work_email = '' THEN RETURN NEW; END IF;
  INSERT INTO canonical_contacts (primary_email, display_name, canonical_name, odoo_employee_id, department, role, contact_type, match_method, match_confidence, last_matched_at)
  VALUES (LOWER(NEW.work_email), NEW.name, LOWER(NEW.name), NEW.odoo_employee_id, NEW.department_name, COALESCE(NEW.job_title, NEW.job_name), 'internal_employee', 'email_exact', 0.99, now())
  ON CONFLICT ((LOWER(primary_email))) DO UPDATE SET
    odoo_employee_id = EXCLUDED.odoo_employee_id,
    department = COALESCE(canonical_contacts.department, EXCLUDED.department),
    role = COALESCE(canonical_contacts.role, EXCLUDED.role),
    last_matched_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION canonical_contacts_upsert_from_contact() RETURNS trigger AS $$
DECLARE v_cc_id bigint;
BEGIN
  IF NEW.email IS NULL OR NEW.email = '' THEN RETURN NEW; END IF;
  SELECT cc.id INTO v_cc_id
  FROM canonical_companies cc JOIN companies comp ON comp.canonical_name=cc.canonical_name
  WHERE comp.id = NEW.company_id LIMIT 1;
  INSERT INTO canonical_contacts (primary_email, display_name, canonical_name, odoo_partner_id, canonical_company_id, is_customer, is_supplier, contact_type, match_method, match_confidence, last_matched_at)
  VALUES (
    LOWER(NEW.email), NEW.name, LOWER(NEW.name), NEW.odoo_partner_id, v_cc_id,
    COALESCE(NEW.is_customer, false), COALESCE(NEW.is_supplier, false),
    CASE WHEN COALESCE(NEW.is_customer, false) THEN 'external_customer'
         WHEN COALESCE(NEW.is_supplier, false) THEN 'external_supplier'
         ELSE 'external_unresolved' END,
    'email_exact', 0.99, now()
  )
  ON CONFLICT ((LOWER(primary_email))) DO UPDATE SET
    odoo_partner_id = COALESCE(canonical_contacts.odoo_partner_id, EXCLUDED.odoo_partner_id),
    canonical_company_id = COALESCE(canonical_contacts.canonical_company_id, EXCLUDED.canonical_company_id),
    is_customer = canonical_contacts.is_customer OR EXCLUDED.is_customer,
    is_supplier = canonical_contacts.is_supplier OR EXCLUDED.is_supplier,
    last_matched_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cct_from_user ON odoo_users;
CREATE TRIGGER trg_cct_from_user AFTER INSERT OR UPDATE ON odoo_users
  FOR EACH ROW EXECUTE FUNCTION canonical_contacts_upsert_from_user();

DROP TRIGGER IF EXISTS trg_cct_from_employee ON odoo_employees;
CREATE TRIGGER trg_cct_from_employee AFTER INSERT OR UPDATE ON odoo_employees
  FOR EACH ROW EXECUTE FUNCTION canonical_contacts_upsert_from_employee();

DROP TRIGGER IF EXISTS trg_cct_from_contact ON contacts;
CREATE TRIGGER trg_cct_from_contact AFTER INSERT OR UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION canonical_contacts_upsert_from_contact();

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_trigger','canonical_contacts','SP3 Task 6: incremental triggers (users/employees/contacts)','20260423_sp3_06_canonical_contacts_triggers.sql','silver-sp3',true);

COMMIT;
