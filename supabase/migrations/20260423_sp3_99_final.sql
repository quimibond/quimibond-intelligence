BEGIN;

INSERT INTO audit_runs (run_id, source, model, invariant_key, bucket_key, odoo_value, supabase_value, diff, severity, date_from, date_to, details, run_at)
SELECT
  gen_random_uuid(),
  'supabase', 'final', 'sp3_done', 'global', NULL, NULL, NULL, 'ok', NULL, NULL,
  jsonb_build_object(
    'label', 'sp3-done-' || to_char(now(),'YYYYMMDD-HH24MISS'),
    'canonical_companies', (SELECT COUNT(*) FROM canonical_companies),
    'canonical_companies_shadows', (SELECT COUNT(*) FROM canonical_companies WHERE has_shadow_flag),
    'canonical_contacts', (SELECT COUNT(*) FROM canonical_contacts),
    'canonical_products', (SELECT COUNT(*) FROM canonical_products),
    'canonical_employees', (SELECT COUNT(*) FROM canonical_employees),
    'source_links', (SELECT COUNT(*) FROM source_links WHERE superseded_at IS NULL),
    'mdm_manual_overrides', (SELECT COUNT(*) FROM mdm_manual_overrides),
    'canonical_invoices_fk_emisor', (SELECT COUNT(*) FROM canonical_invoices WHERE emisor_canonical_company_id IS NOT NULL),
    'canonical_invoices_fk_receptor', (SELECT COUNT(*) FROM canonical_invoices WHERE receptor_canonical_company_id IS NOT NULL),
    'canonical_payments_fk', (SELECT COUNT(*) FROM canonical_payments WHERE counterparty_canonical_company_id IS NOT NULL),
    'valid_fks', (SELECT COUNT(*) FROM pg_constraint WHERE conrelid IN ('canonical_invoices'::regclass, 'canonical_payments'::regclass, 'canonical_credit_notes'::regclass) AND contype='f' AND convalidated=true),
    'active_crons', (SELECT COUNT(*) FROM cron.job WHERE jobname LIKE 'silver_%' AND active=true),
    'quimibond_canonical_id', (SELECT id FROM canonical_companies WHERE is_internal=true LIMIT 1)
  ),
  now();

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('sp3_done','','Silver SP3 MDM complete','20260423_sp3_99_final.sql','silver-sp3',true);

COMMIT;
