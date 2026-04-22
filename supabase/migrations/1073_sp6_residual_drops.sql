-- Migration: 1073_sp6_residual_drops
-- Post-SP5 cleanup of 4 residual legacy objects verified 0-ref.
-- Trigger fn body confirmed: only inserts into blacklist_alerts (safe to drop).
-- Skipped: overhead_factor_12m (3 callers), claude_cost_summary (2 callers).
-- IRREVERSIBLE.

BEGIN;

-- Drop blacklist trigger + trigger fn before the table
DROP TRIGGER IF EXISTS trg_blacklist_alerts_on_syntage_insert ON syntage_invoices;
DROP FUNCTION IF EXISTS public.trg_blacklist_alerts_on_syntage_insert() CASCADE;

DROP TABLE IF EXISTS odoo_invoices_archive_dup_cfdi_uuid_2026_04_20 CASCADE;
DROP TABLE IF EXISTS odoo_payment_invoice_links CASCADE;
DROP TABLE IF EXISTS blacklist_alerts CASCADE;
DROP TABLE IF EXISTS cashflow_journal_classification CASCADE;

INSERT INTO audit_runs (run_id, run_at, source, model, invariant_key, bucket_key, severity, details)
VALUES (
  gen_random_uuid(), now(), 'supabase', 'silver_sp6', 'sp6.residual_drops', 'sp6_residual_drops', 'ok',
  jsonb_build_object(
    'label', 'sp6_residual_drops_complete',
    'dropped', ARRAY[
      'odoo_invoices_archive_dup_cfdi_uuid_2026_04_20',
      'odoo_payment_invoice_links',
      'blacklist_alerts',
      'cashflow_journal_classification'
    ],
    'skipped_due_to_callers', ARRAY['overhead_factor_12m','claude_cost_summary'],
    'bytes_reclaimed_approx', 6750000
  )
);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'DROP','multiple',
  'SP6 residual drops: 4 tables + 1 trigger + trigger fn (~6.7 MB)',
  'DROP TABLE/TRIGGER/FUNCTION IF EXISTS … CASCADE',
  'silver-sp6-residual-drops', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by='silver-sp6-residual-drops');

COMMIT;
