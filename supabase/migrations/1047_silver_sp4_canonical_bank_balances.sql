-- supabase/migrations/1047_silver_sp4_canonical_bank_balances.sql
--
-- Silver SP4 — Task 8: canonical_bank_balances VIEW
-- Spec §5.15; Plan Task 8. Small-volume (22 rows) → VIEW.

BEGIN;

DROP VIEW IF EXISTS canonical_bank_balances;

CREATE VIEW canonical_bank_balances AS
SELECT
  bb.id                           AS canonical_id,
  bb.odoo_journal_id,
  bb.name,
  bb.journal_type,
  bb.currency,
  bb.bank_account,
  bb.current_balance,
  bb.current_balance_mxn,
  bb.odoo_company_id,
  bb.company_name,
  bb.updated_at,
  CASE WHEN now() - bb.updated_at > interval '48 hours'
       THEN true ELSE false END   AS is_stale,
  CASE
    WHEN bb.journal_type = 'credit_card'            THEN 'debt'
    WHEN bb.current_balance_mxn < 0                  THEN 'debt'
    WHEN bb.journal_type IN ('bank','cash')
     AND bb.current_balance_mxn > 0                  THEN 'cash'
    ELSE 'other'
  END                              AS classification,
  now()                            AS refreshed_at
FROM odoo_bank_balances bb;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE_VIEW', 'canonical_bank_balances', 'Pattern B view over odoo_bank_balances',
       'supabase/migrations/1047_silver_sp4_canonical_bank_balances.sql',
       'silver-sp4-task-8', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by = 'silver-sp4-task-8');

COMMIT;
