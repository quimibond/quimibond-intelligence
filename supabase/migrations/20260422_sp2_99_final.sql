BEGIN;

INSERT INTO audit_runs (run_id, source, model, invariant_key, bucket_key, odoo_value, supabase_value, diff, severity, date_from, date_to, details, run_at)
SELECT
  gen_random_uuid(),
  'supabase', 'final', 'sp2_done', 'global', NULL, NULL, NULL, 'ok', NULL, NULL,
  jsonb_build_object(
    'label',                          'sp2-done-' || to_char(now(),'YYYYMMDD-HH24MISS'),
    'canonical_invoices',             (SELECT COUNT(*) FROM canonical_invoices),
    'canonical_invoices_non_hist',    (SELECT COUNT(*) FROM canonical_invoices WHERE NOT historical_pre_odoo),
    'canonical_payments',             (SELECT COUNT(*) FROM canonical_payments),
    'canonical_payment_allocations',  (SELECT COUNT(*) FROM canonical_payment_allocations),
    'canonical_credit_notes',         (SELECT COUNT(*) FROM canonical_credit_notes),
    'canonical_tax_events',           (SELECT COUNT(*) FROM canonical_tax_events),
    'mdm_manual_overrides',           (SELECT COUNT(*) FROM mdm_manual_overrides),
    'active_invariants',              (SELECT COUNT(*) FROM audit_tolerances WHERE enabled=true),
    'open_issues',                    (SELECT COUNT(*) FROM reconciliation_issues WHERE resolved_at IS NULL),
    'active_crons',                   (SELECT COUNT(*) FROM cron.job WHERE jobname LIKE 'silver_sp2_%' AND active=true),
    'uuid_pct_post2021',              (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE sat_uuid IS NOT NULL OR cfdi_uuid_odoo IS NOT NULL) / NULLIF(COUNT(*),0), 2)
                                       FROM canonical_invoices
                                       WHERE invoice_date >= '2021-01-01' OR fecha_timbrado >= '2021-01-01'::timestamptz)
  ),
  now();

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('sp2_done','','Silver SP2 Cat A complete','20260422_sp2_99_final.sql','silver-sp2',true);

COMMIT;
