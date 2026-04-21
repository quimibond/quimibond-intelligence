-- supabase/migrations/1058_silver_sp4_widen_issue_type_check.sql
--
-- Silver SP4 — Task 18 unblock: DROP legacy issue_type CHECK constraint
-- The legacy allowlist only covered SP2 values; SP4 invariants use dot-notation keys.
-- invariant_key column carries full semantics; issue_type is now free-form text.

BEGIN;

ALTER TABLE reconciliation_issues
  DROP CONSTRAINT IF EXISTS reconciliation_issues_issue_type_check;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'ALTER_TABLE', 'reconciliation_issues',
       'Drop legacy issue_type CHECK — SP4 invariants use dot-notation keys',
       'supabase/migrations/1058_silver_sp4_widen_issue_type_check.sql',
       'silver-sp4-task-18-fix', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by = 'silver-sp4-task-18-fix');

COMMIT;
