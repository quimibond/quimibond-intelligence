-- supabase/migrations/1063_silver_sp4_close_audit.sql
--
-- Silver SP4 — Task 23: closing audit_runs snapshot
-- Spec §18; Plan Task 23.

INSERT INTO audit_runs (run_id, source, model, invariant_key, bucket_key, severity, details)
SELECT gen_random_uuid(), 'supabase', 'silver_sp4', 'sp4.close', 'sp4_close', 'ok',
       jsonb_build_object(
         'label', 'post_sp4_snapshot',
         'canonical_invoices_resolved_pct',
           (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE amount_total_mxn_resolved > 0) / NULLIF(COUNT(*),0), 2)
              FROM canonical_invoices),
         'canonical_companies_with_ltv',
           (SELECT COUNT(*) FROM canonical_companies WHERE lifetime_value_mxn > 0),
         'reconciliation_issues_open',
           (SELECT COUNT(*) FROM reconciliation_issues WHERE resolved_at IS NULL),
         'reconciliation_issues_open_by_severity',
           (SELECT jsonb_object_agg(severity, c)
              FROM (SELECT severity, COUNT(*) c FROM reconciliation_issues
                    WHERE resolved_at IS NULL GROUP BY 1) x),
         'reconciliation_issues_without_invariant_key',
           (SELECT COUNT(*) FROM reconciliation_issues
              WHERE resolved_at IS NULL AND invariant_key IS NULL),
         'audit_tolerances_enabled',
           (SELECT COUNT(*) FROM audit_tolerances WHERE enabled),
         'ai_extracted_facts_rows',
           (SELECT COUNT(*) FROM ai_extracted_facts),
         'gold_ceo_inbox_rows',      (SELECT COUNT(*) FROM gold_ceo_inbox),
         'cron_jobs_sp4',
           (SELECT jsonb_agg(jsonb_build_object(
                     'name', jobname, 'schedule', schedule, 'active', active))
              FROM cron.job WHERE jobname LIKE 'silver_sp4%'),
         'finished_at', now()
       )
WHERE NOT EXISTS (SELECT 1 FROM audit_runs WHERE details->>'label' = 'post_sp4_snapshot');

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'SEED', 'audit_runs', 'SP4 closing snapshot',
       'supabase/migrations/1063_silver_sp4_close_audit.sql', 'silver-sp4-task-23', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by = 'silver-sp4-task-23');
