-- supabase/migrations/1040_silver_sp4_preflight.sql
--
-- Silver SP4 — Task 1: baseline audit_run + cron inventory snapshot
-- Spec: docs/superpowers/specs/2026-04-21-silver-architecture.md §11 SP4
-- Plan: docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold.md
-- Idempotent: WHERE NOT EXISTS guards on both INSERTs (re-apply safe).

BEGIN;

INSERT INTO audit_runs (run_id, source, model, invariant_key, bucket_key, severity, details)
SELECT
  gen_random_uuid(),
  'supabase',
  'silver_sp4',
  'sp4.baseline',
  'sp4_preflight',
  'ok',
  jsonb_build_object(
    'label', 'pre_sp4_baseline',
    'canonical_invoices',          (SELECT COUNT(*) FROM canonical_invoices),
    'canonical_invoices_with_mxn_resolved',
                                    (SELECT COUNT(*) FROM canonical_invoices
                                       WHERE amount_total_mxn_resolved IS NOT NULL
                                         AND amount_total_mxn_resolved > 0),
    'canonical_payments',          (SELECT COUNT(*) FROM canonical_payments),
    'canonical_payment_allocations',(SELECT COUNT(*) FROM canonical_payment_allocations),
    'canonical_credit_notes',      (SELECT COUNT(*) FROM canonical_credit_notes),
    'canonical_tax_events',        (SELECT COUNT(*) FROM canonical_tax_events),
    'canonical_companies',         (SELECT COUNT(*) FROM canonical_companies),
    'canonical_companies_with_ltv',(SELECT COUNT(*) FROM canonical_companies
                                       WHERE lifetime_value_mxn IS NOT NULL
                                         AND lifetime_value_mxn > 0),
    'canonical_contacts',          (SELECT COUNT(*) FROM canonical_contacts),
    'canonical_products',          (SELECT COUNT(*) FROM canonical_products),
    'source_links',                (SELECT COUNT(*) FROM source_links),
    'mdm_manual_overrides',        (SELECT COUNT(*) FROM mdm_manual_overrides),
    'reconciliation_issues_open',  (SELECT COUNT(*) FROM reconciliation_issues
                                       WHERE resolved_at IS NULL),
    'reconciliation_issues_open_with_invariant_key',
                                    (SELECT COUNT(*) FROM reconciliation_issues
                                       WHERE resolved_at IS NULL
                                         AND invariant_key IS NOT NULL),
    'audit_tolerances_enabled',    (SELECT COUNT(*) FROM audit_tolerances WHERE enabled),
    'facts',                       (SELECT COUNT(*) FROM facts),
    'cron_jobs',                   (SELECT jsonb_agg(jsonb_build_object(
                                                'name', jobname,
                                                'schedule', schedule,
                                                'active', active))
                                       FROM cron.job)
  )
WHERE NOT EXISTS (
  SELECT 1 FROM audit_runs WHERE details->>'label' = 'pre_sp4_baseline'
);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'SEED', 'audit_runs', 'SP4 pre-flight baseline snapshot',
       'supabase/migrations/1040_silver_sp4_preflight.sql', 'silver-sp4-task-1', true
WHERE NOT EXISTS (
  SELECT 1 FROM schema_changes WHERE triggered_by = 'silver-sp4-task-1'
);

COMMIT;
