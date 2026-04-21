-- Silver SP3 MDM — Task 0 Baseline Snapshot
-- Applied: 2026-04-22
-- Branch: silver-sp3-mdm (from fd62141)
-- Purpose: Capture pre-SP3 state in audit_runs and schema_changes.

BEGIN;

INSERT INTO audit_runs (run_id, source, model, invariant_key, bucket_key, odoo_value, supabase_value, diff, severity, date_from, date_to, details, run_at)
SELECT
  gen_random_uuid(),
  'supabase', 'baseline', 'pre_sp3_baseline', 'global',
  NULL, NULL, NULL, 'ok', NULL, NULL,
  jsonb_build_object(
    'label', 'sp3-baseline-' || to_char(now(),'YYYYMMDD-HH24MISS'),
    'canonical_invoices', (SELECT COUNT(*) FROM canonical_invoices),
    'ci_unresolved_receptor', (SELECT COUNT(*) FROM canonical_invoices WHERE receptor_company_id IS NULL AND has_sat_record=true),
    'ci_unresolved_emisor', (SELECT COUNT(*) FROM canonical_invoices WHERE emisor_company_id IS NULL AND has_sat_record=true),
    'canonical_payments', (SELECT COUNT(*) FROM canonical_payments),
    'canonical_credit_notes', (SELECT COUNT(*) FROM canonical_credit_notes),
    'canonical_tax_events', (SELECT COUNT(*) FROM canonical_tax_events),
    'companies', (SELECT COUNT(*) FROM companies),
    'contacts', (SELECT COUNT(*) FROM contacts),
    'odoo_employees', (SELECT COUNT(*) FROM odoo_employees),
    'odoo_users', (SELECT COUNT(*) FROM odoo_users),
    'odoo_products', (SELECT COUNT(*) FROM odoo_products),
    'entities', (SELECT COUNT(*) FROM entities),
    'mdm_manual_overrides', (SELECT COUNT(*) FROM mdm_manual_overrides),
    'active_invariants', (SELECT COUNT(*) FROM audit_tolerances WHERE enabled=true)
  ),
  now();

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('sp3_baseline', '', 'Silver SP3 baseline snapshot captured', '20260423_sp3_00_baseline.sql', 'silver-sp3', true);

COMMIT;
