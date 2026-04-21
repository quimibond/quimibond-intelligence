-- supabase/migrations/1050_silver_sp4_canonical_chart_of_accounts.sql
--
-- Silver SP4 — Task 11: canonical_chart_of_accounts VIEW
-- Spec §5.18; Plan Task 11.

BEGIN;

DROP VIEW IF EXISTS canonical_chart_of_accounts;

CREATE VIEW canonical_chart_of_accounts AS
SELECT
  coa.id                              AS canonical_id,
  coa.odoo_account_id,
  coa.code,
  coa.name,
  coa.account_type,
  coa.reconcile,
  coa.deprecated,
  coa.active,
  coa.odoo_company_id,
  LENGTH(coa.code) - LENGTH(REPLACE(coa.code, '-', '')) + 1 AS tree_level,
  SPLIT_PART(coa.code, '-', 1)        AS level_1_code,
  coa.synced_at
FROM odoo_chart_of_accounts coa;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE_VIEW', 'canonical_chart_of_accounts', 'Pattern B view with tree_level / level_1_code',
       'supabase/migrations/1050_silver_sp4_canonical_chart_of_accounts.sql',
       'silver-sp4-task-11', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by = 'silver-sp4-task-11');

COMMIT;
