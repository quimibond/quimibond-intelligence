BEGIN;

-- 21a. pg_cron: matcher_all_pending every 2h (offset HH:35 to not overlap SP2 reconcile HH:15)
DO $$ DECLARE r record;
BEGIN
  FOR r IN SELECT jobname FROM cron.job WHERE jobname='silver_sp3_matcher_all_pending' LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

SELECT cron.schedule(
  'silver_sp3_matcher_all_pending',
  '35 */2 * * *',
  $$SELECT * FROM matcher_all_pending();$$
);

-- 21b. Trigger on companies INSERT/UPDATE — auto-create canonical_companies row
CREATE OR REPLACE FUNCTION trg_canonical_company_from_odoo() RETURNS trigger AS $$
BEGIN
  INSERT INTO canonical_companies (
    canonical_name, display_name, rfc, odoo_partner_id, primary_entity_kg_id, primary_email_domain,
    is_customer, is_supplier, country, city,
    industry, business_type, credit_limit, payment_term, supplier_payment_term,
    description, strategic_notes, relationship_type, relationship_summary,
    key_products, risk_signals, opportunity_signals, enriched_at, enrichment_source,
    match_method, match_confidence, last_matched_at
  ) VALUES (
    NEW.canonical_name, NEW.name, NULLIF(TRIM(NEW.rfc),''),
    NEW.odoo_partner_id, NEW.entity_id, LOWER(NULLIF(TRIM(NEW.domain),'')),
    COALESCE(NEW.is_customer, false), COALESCE(NEW.is_supplier, false),
    NEW.country, NEW.city, NEW.industry, NEW.business_type,
    NEW.credit_limit, NEW.payment_term, NEW.supplier_payment_term,
    NEW.description, NEW.strategic_notes, NEW.relationship_type, NEW.relationship_summary,
    NEW.key_products, NEW.risk_signals, NEW.opportunity_signals, NEW.enriched_at, NEW.enrichment_source,
    'odoo_partner_id', 0.99, now()
  )
  ON CONFLICT (canonical_name) DO UPDATE SET
    rfc = COALESCE(canonical_companies.rfc, EXCLUDED.rfc),
    odoo_partner_id = COALESCE(canonical_companies.odoo_partner_id, EXCLUDED.odoo_partner_id),
    is_customer = canonical_companies.is_customer OR EXCLUDED.is_customer,
    is_supplier = canonical_companies.is_supplier OR EXCLUDED.is_supplier,
    country = COALESCE(canonical_companies.country, EXCLUDED.country),
    city = COALESCE(canonical_companies.city, EXCLUDED.city),
    last_matched_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cc_from_odoo ON companies;
CREATE TRIGGER trg_cc_from_odoo AFTER INSERT OR UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION trg_canonical_company_from_odoo();

-- 21c. Trigger on syntage_invoices INSERT — auto-shadow new RFCs
CREATE OR REPLACE FUNCTION trg_matcher_company_on_syntage_invoice() RETURNS trigger AS $$
BEGIN
  PERFORM matcher_company_if_new_rfc(NEW.emisor_rfc, NEW.emisor_nombre, NEW.receptor_rfc, NEW.receptor_nombre);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sat_invoice_matcher ON syntage_invoices;
CREATE TRIGGER trg_sat_invoice_matcher AFTER INSERT ON syntage_invoices
  FOR EACH ROW EXECUTE FUNCTION trg_matcher_company_on_syntage_invoice();

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('cron_schedule','canonical_companies','SP3 Task 21: matcher cron + Bronze auto-canonical triggers','20260423_sp3_21_pg_cron_and_bronze_triggers.sql','silver-sp3',true);

COMMIT;
