-- supabase/migrations/1049_silver_sp4_canonical_account_balances.sql
--
-- Silver SP4 — Task 10: canonical_account_balances VIEW
-- Spec §5.17; Plan Task 10.

BEGIN;

DROP VIEW IF EXISTS canonical_account_balances;

CREATE VIEW canonical_account_balances AS
SELECT
  ab.id                            AS canonical_id,
  ab.odoo_account_id,
  ab.account_code,
  ab.account_name,
  coa.account_type,
  ab.period,
  ab.debit,
  ab.credit,
  ab.balance,
  coa.deprecated,
  ab.synced_at,
  CASE
    WHEN coa.account_type LIKE 'asset_%'     THEN 'asset'
    WHEN coa.account_type LIKE 'liability_%' THEN 'liability'
    WHEN coa.account_type LIKE 'equity%'     THEN 'equity'
    WHEN coa.account_type LIKE 'income%'     THEN 'income'
    WHEN coa.account_type LIKE 'expense%'    THEN 'expense'
    ELSE 'other'
  END                              AS balance_sheet_bucket,
  now()                            AS refreshed_at
FROM odoo_account_balances ab
LEFT JOIN odoo_chart_of_accounts coa ON coa.odoo_account_id = ab.odoo_account_id;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE_VIEW', 'canonical_account_balances', 'Pattern B view with balance_sheet_bucket',
       'supabase/migrations/1049_silver_sp4_canonical_account_balances.sql',
       'silver-sp4-task-10', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by = 'silver-sp4-task-10');

COMMIT;
