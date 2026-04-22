-- Migration: 1067_silver_sp5_null_invariant_keys_remap
-- SP5 Task 26: Remap reconciliation_issues rows with invariant_key IS NULL.
--
-- Legacy issue_type → current dotted invariant_key mapping:
--   cancelled_but_posted       → invoice.state_mismatch_posted_cancelled  (97 rows)
--   amount_mismatch            → invoice.amount_mismatch                  (15 rows)
--   partner_blacklist_69b      → tax.blacklist_69b_definitive_active       ( 2 rows)
--   posted_but_sat_uncertified → invoice.missing_sat_timbrado              ( 1 row)
--
-- All 115 rows mapped; 0 auto-resolved as obsolete.
-- Followed by sp5_assign_issues() re-run to assign newly-remapped rows.

BEGIN;

-- Remap known issue_types to current enabled invariant_keys
UPDATE reconciliation_issues
SET invariant_key = CASE issue_type
  WHEN 'cancelled_but_posted'       THEN 'invoice.state_mismatch_posted_cancelled'
  WHEN 'amount_mismatch'            THEN 'invoice.amount_mismatch'
  WHEN 'partner_blacklist_69b'      THEN 'tax.blacklist_69b_definitive_active'
  WHEN 'posted_but_sat_uncertified' THEN 'invoice.missing_sat_timbrado'
  ELSE invariant_key
END
WHERE invariant_key IS NULL AND resolved_at IS NULL;

-- Auto-resolve any residual rows whose issue_type had no current mapping
UPDATE reconciliation_issues
SET resolved_at = now(),
    resolution = 'sp5_obsolete_invariant'
WHERE invariant_key IS NULL
  AND resolved_at IS NULL;

-- Audit record
INSERT INTO audit_runs (run_id, run_at, source, model, invariant_key, bucket_key, severity, details)
VALUES (
  gen_random_uuid(), now(), 'supabase', 'silver_sp5', 'sp5.task26', 'sp5_task26_null_invariant_keys', 'ok',
  jsonb_build_object(
    'label', 'sp5_task26_null_invariant_keys_remap',
    'residual_after_remap', (SELECT COUNT(*) FROM reconciliation_issues WHERE invariant_key IS NULL AND resolved_at IS NULL),
    'auto_resolved_count', (SELECT COUNT(*) FROM reconciliation_issues WHERE resolution = 'sp5_obsolete_invariant')
  )
);

-- Schema change record (idempotent)
INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'BACKFILL', 'reconciliation_issues',
  'Remap NULL invariant_key rows to current dotted keys; auto-resolve residuals (SP5 Task 26)',
  'UPDATE reconciliation_issues SET invariant_key = CASE issue_type WHEN cancelled_but_posted THEN invoice.state_mismatch_posted_cancelled WHEN amount_mismatch THEN invoice.amount_mismatch WHEN partner_blacklist_69b THEN tax.blacklist_69b_definitive_active WHEN posted_but_sat_uncertified THEN invoice.missing_sat_timbrado END; UPDATE residuals SET resolved_at=now()',
  'silver-sp5-task-26', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by = 'silver-sp5-task-26');

COMMIT;
