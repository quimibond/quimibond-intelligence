-- Migration: 1072_silver_sp5_close_audit
-- Applied: 2026-04-22 via MCP
-- Purpose: Insert closing audit_runs snapshot for SP5 Task 30 DoD certification

INSERT INTO audit_runs (run_id, run_at, source, model, invariant_key, bucket_key, severity, details)
VALUES (
  gen_random_uuid(), now(), 'supabase', 'silver_sp5', 'sp5.task30', 'sp5_close', 'ok',
  jsonb_build_object(
    'label', 'silver_architecture_cutover_complete',
    'sp5_branch', 'silver-sp5-t29-physical-drop',
    'sp5_closing_snapshot', jsonb_build_object(
      'canonical_invoices', (SELECT COUNT(*) FROM canonical_invoices),
      'canonical_invoices_with_residual_mxn_resolved', (SELECT COUNT(*) FROM canonical_invoices WHERE amount_residual_mxn_resolved IS NOT NULL),
      'reconciliation_issues_open', (SELECT COUNT(*) FROM reconciliation_issues WHERE resolved_at IS NULL),
      'reconciliation_issues_open_assigned', (SELECT COUNT(*) FROM reconciliation_issues WHERE resolved_at IS NULL AND assignee_canonical_contact_id IS NOT NULL),
      'reconciliation_issues_null_invariant_key', (SELECT COUNT(*) FROM reconciliation_issues WHERE resolved_at IS NULL AND invariant_key IS NULL),
      'gold_ceo_inbox_rows', (SELECT COUNT(*) FROM gold_ceo_inbox),
      'canonical_companies_with_ltv', (SELECT COUNT(*) FROM canonical_companies WHERE lifetime_value_mxn > 0),
      'audit_tolerances_enabled', (SELECT COUNT(*) FROM audit_tolerances WHERE enabled = true),
      'legacy_objects_remaining', (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE '%_deprecated_sp5')
    )
  )
);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'AUDIT_RUN', 'audit_runs',
  'silver_architecture_cutover_complete snapshot (SP5 Task 30 — DoD cleared)',
  'INSERT audit_runs (label=silver_architecture_cutover_complete)',
  'silver-sp5-task-30', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by='silver-sp5-task-30');
