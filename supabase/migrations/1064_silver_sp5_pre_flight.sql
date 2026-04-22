-- Migration: 1064_silver_sp5_pre_flight
-- Purpose: record pre_sp5_baseline snapshot before any SP5 rewire/drops
-- Idempotent: uses WHERE NOT EXISTS guards

INSERT INTO audit_runs (run_id, run_at, source, model, invariant_key, bucket_key, severity, details)
SELECT
  gen_random_uuid(),
  now(),
  'supabase',
  'silver_sp5',
  'sp5.baseline',
  '',
  'ok',
  jsonb_build_object(
    'label', 'pre_sp5_baseline',
    'plan',  '2026-04-21-silver-sp5-cutover',
    'counts', jsonb_build_object(
      'canonical_invoices',
        (SELECT COUNT(*) FROM canonical_invoices),
      'canonical_invoices_with_residual_mxn_resolved',
        (SELECT COUNT(*) FROM canonical_invoices WHERE amount_residual_mxn_resolved IS NOT NULL),
      -- plan referenced 'amount_residual' (non-existent); using amount_residual_mxn_odoo (Odoo-side residual, the closest semantic match to the plan's intent)
      'canonical_invoices_with_open_residual',
        (SELECT COUNT(*) FROM canonical_invoices WHERE amount_residual_mxn_odoo > 0),
      'canonical_payments',
        (SELECT COUNT(*) FROM canonical_payments),
      'canonical_companies_with_ltv',
        (SELECT COUNT(*) FROM canonical_companies WHERE lifetime_value_mxn > 0),
      'reconciliation_issues_open',
        (SELECT COUNT(*) FROM reconciliation_issues WHERE resolved_at IS NULL),
      'reconciliation_issues_open_null_invariant_key',
        (SELECT COUNT(*) FROM reconciliation_issues
          WHERE resolved_at IS NULL AND invariant_key IS NULL),
      'reconciliation_issues_open_null_assignee',
        (SELECT COUNT(*) FROM reconciliation_issues
          WHERE resolved_at IS NULL AND assignee_canonical_contact_id IS NULL),
      'gold_ceo_inbox_rows',
        (SELECT COUNT(*) FROM gold_ceo_inbox),
      'audit_tolerances_enabled',
        (SELECT COUNT(*) FROM audit_tolerances WHERE enabled = true)
    )
  )
WHERE NOT EXISTS (
  SELECT 1 FROM audit_runs
  WHERE details->>'label' = 'pre_sp5_baseline'
    AND run_at > now() - interval '1 day'
);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT
  'AUDIT_RUN',
  'audit_runs',
  'pre_sp5_baseline snapshot recorded',
  'INSERT audit_runs (label=pre_sp5_baseline)',
  'silver-sp5-task-1',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM schema_changes
  WHERE triggered_by = 'silver-sp5-task-1'
);
