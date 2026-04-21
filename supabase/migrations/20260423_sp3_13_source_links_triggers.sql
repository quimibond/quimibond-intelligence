BEGIN;

CREATE OR REPLACE FUNCTION trg_source_link_company() RETURNS trigger AS $$
BEGIN
  IF NEW.odoo_partner_id IS NOT NULL THEN
    INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
    VALUES ('company', NEW.id::text, 'odoo', 'companies',
            (SELECT c.id::text FROM companies c WHERE c.canonical_name = NEW.canonical_name LIMIT 1),
            NEW.odoo_partner_id::text,
            COALESCE(NEW.match_method, 'odoo_partner_id'),
            COALESCE(NEW.match_confidence, 0.99), 'system')
    ON CONFLICT (canonical_entity_type, source, source_id) WHERE superseded_at IS NULL DO NOTHING;
  END IF;
  IF NEW.rfc IS NOT NULL AND NEW.has_shadow_flag THEN
    INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
    VALUES ('company', NEW.id::text, 'sat', 'syntage_invoices', NEW.rfc, NEW.rfc, 'sat_only', 0.50, 'system')
    ON CONFLICT (canonical_entity_type, source, source_id) WHERE superseded_at IS NULL DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_source_link_contact() RETURNS trigger AS $$
BEGIN
  IF NEW.odoo_employee_id IS NOT NULL THEN
    INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
    VALUES ('contact', NEW.id::text, 'odoo', 'odoo_employees', NEW.odoo_employee_id::text, NEW.primary_email, 'email_exact', 0.99, 'system')
    ON CONFLICT (canonical_entity_type, source, source_id) WHERE superseded_at IS NULL DO NOTHING;
  END IF;
  IF NEW.odoo_user_id IS NOT NULL THEN
    INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
    VALUES ('contact', NEW.id::text, 'odoo', 'odoo_users', NEW.odoo_user_id::text, NEW.primary_email, 'email_exact', 0.99, 'system')
    ON CONFLICT (canonical_entity_type, source, source_id) WHERE superseded_at IS NULL DO NOTHING;
  END IF;
  IF NEW.odoo_partner_id IS NOT NULL THEN
    INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
    VALUES ('contact', NEW.id::text, 'odoo', 'contacts', NEW.odoo_partner_id::text, NEW.primary_email, 'email_exact', 0.99, 'system')
    ON CONFLICT (canonical_entity_type, source, source_id) WHERE superseded_at IS NULL DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_source_link_product() RETURNS trigger AS $$
BEGIN
  INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
  VALUES ('product', NEW.id::text, 'odoo', 'odoo_products', NEW.odoo_product_id::text, NEW.internal_ref, 'internal_ref_exact', 1.000, 'system')
  ON CONFLICT (canonical_entity_type, source, source_id) WHERE superseded_at IS NULL DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sl_company ON canonical_companies;
CREATE TRIGGER trg_sl_company AFTER INSERT OR UPDATE ON canonical_companies
  FOR EACH ROW EXECUTE FUNCTION trg_source_link_company();

DROP TRIGGER IF EXISTS trg_sl_contact ON canonical_contacts;
CREATE TRIGGER trg_sl_contact AFTER INSERT OR UPDATE ON canonical_contacts
  FOR EACH ROW EXECUTE FUNCTION trg_source_link_contact();

DROP TRIGGER IF EXISTS trg_sl_product ON canonical_products;
CREATE TRIGGER trg_sl_product AFTER INSERT OR UPDATE ON canonical_products
  FOR EACH ROW EXECUTE FUNCTION trg_source_link_product();

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_trigger','source_links','SP3 Task 13: auto-insert triggers on canonical_*','20260423_sp3_13_source_links_triggers.sql','silver-sp3',true);

COMMIT;
