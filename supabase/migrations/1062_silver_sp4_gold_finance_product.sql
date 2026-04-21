-- supabase/migrations/1062_silver_sp4_gold_finance_product.sql
--
-- Silver SP4 — Task 22: gold_pl_statement, gold_balance_sheet, gold_cashflow, gold_product_performance
-- Spec §3.3; Plan Task 22.
-- Separator fix: Quimibond CoA uses '.' not '-' (Task 11 finding).

BEGIN;

-- ===== gold_pl_statement ============================================
DROP VIEW IF EXISTS gold_pl_statement;

CREATE VIEW gold_pl_statement AS
WITH agg AS (
  -- Pre-aggregate to (period, lvl1) so no nesting needed in outer select
  SELECT
    period,
    SPLIT_PART(account_code, '.', 1)           AS lvl1,
    balance_sheet_bucket,
    SUM(balance)                               AS bucket_balance,
    MAX(account_type)                          AS bucket_account_type
  FROM canonical_account_balances
  WHERE balance_sheet_bucket IN ('income','expense')
  GROUP BY period, SPLIT_PART(account_code, '.', 1), balance_sheet_bucket
),
lvl1_agg AS (
  -- Collapse multiple buckets per lvl1 so each (period, lvl1) is one row
  SELECT
    period,
    lvl1,
    SUM(bucket_balance)       AS lvl1_balance,
    MAX(bucket_account_type)  AS lvl1_account_type
  FROM agg
  GROUP BY period, lvl1
),
period_totals AS (
  SELECT
    period,
    SUM(CASE WHEN balance_sheet_bucket='income'  THEN bucket_balance END) AS total_income,
    SUM(CASE WHEN balance_sheet_bucket='expense' THEN bucket_balance END) AS total_expense
  FROM agg
  GROUP BY period
)
SELECT
  pt.period,
  pt.total_income,
  pt.total_expense,
  pt.total_income + COALESCE(pt.total_expense, 0)                     AS net_income,
  (SELECT jsonb_object_agg(l.lvl1, jsonb_build_object(
             'balance', l.lvl1_balance,
             'account_type', l.lvl1_account_type))
   FROM lvl1_agg l WHERE l.period = pt.period)                        AS by_level_1,
  now()                                                               AS refreshed_at
FROM period_totals pt;

COMMENT ON VIEW gold_pl_statement IS
  'P&L per period from canonical_account_balances. by_level_1 uses "." separator (Quimibond CoA convention).';

-- ===== gold_balance_sheet ===========================================
DROP VIEW IF EXISTS gold_balance_sheet;

CREATE VIEW gold_balance_sheet AS
WITH agg AS (
  SELECT
    period,
    balance_sheet_bucket,
    SUM(balance)              AS bucket_balance,
    COUNT(DISTINCT account_code) AS accounts_count
  FROM canonical_account_balances
  WHERE balance_sheet_bucket IN ('asset','liability','equity')
  GROUP BY period, balance_sheet_bucket
),
period_totals AS (
  SELECT
    period,
    SUM(CASE WHEN balance_sheet_bucket='asset'     THEN bucket_balance END) AS total_assets,
    SUM(CASE WHEN balance_sheet_bucket='liability' THEN bucket_balance END) AS total_liabilities,
    SUM(CASE WHEN balance_sheet_bucket='equity'    THEN bucket_balance END) AS total_equity
  FROM agg
  GROUP BY period
)
SELECT
  pt.period,
  pt.total_assets,
  pt.total_liabilities,
  pt.total_equity,
  pt.total_assets
    - COALESCE(pt.total_liabilities, 0)
    - COALESCE(pt.total_equity,      0)                              AS unbalanced_amount,
  (SELECT jsonb_object_agg(a.balance_sheet_bucket,
             jsonb_build_object('total', a.bucket_balance,
                                'accounts_count', a.accounts_count))
   FROM agg a WHERE a.period = pt.period)                            AS by_bucket,
  now()                                                              AS refreshed_at
FROM period_totals pt;

COMMENT ON VIEW gold_balance_sheet IS
  'Balance sheet per period. unbalanced_amount will be non-zero until qb19 addon fix §14.2 pushes equity_unaffected.';

-- ===== gold_cashflow ================================================
DROP VIEW IF EXISTS gold_cashflow;

CREATE VIEW gold_cashflow AS
WITH bank AS (
  SELECT classification,
         SUM(current_balance_mxn) AS total_mxn,
         COUNT(*) AS journals
  FROM canonical_bank_balances
  GROUP BY 1
),
ar AS (
  SELECT SUM(total_receivable_mxn) AS receivable_mxn,
         SUM(overdue_amount_mxn)   AS overdue_receivable_mxn
  FROM canonical_companies
  WHERE is_customer = true
),
ap AS (
  SELECT SUM(total_payable_mxn) AS payable_mxn
  FROM canonical_companies
  WHERE is_supplier = true
)
SELECT
  (SELECT total_mxn FROM bank WHERE classification='cash')                AS current_cash_mxn,
  (SELECT total_mxn FROM bank WHERE classification='debt')                AS current_debt_mxn,
  (SELECT receivable_mxn FROM ar)                                         AS total_receivable_mxn,
  (SELECT overdue_receivable_mxn FROM ar)                                 AS overdue_receivable_mxn,
  (SELECT payable_mxn FROM ap)                                            AS total_payable_mxn,
  (SELECT total_mxn FROM bank WHERE classification='cash')
  + (SELECT receivable_mxn FROM ar)
  - (SELECT payable_mxn FROM ap)                                          AS working_capital_mxn,
  (SELECT jsonb_agg(row_to_json(b)) FROM bank b)                          AS bank_breakdown,
  now()                                                                   AS refreshed_at;

-- ===== gold_product_performance ======================================
DROP VIEW IF EXISTS gold_product_performance;

CREATE VIEW gold_product_performance AS
WITH odoo_12m AS (
  SELECT ol.canonical_product_id AS pid,
         SUM(ol.subtotal_mxn)    AS revenue_mxn,
         SUM(ol.qty)             AS units_sold,
         COUNT(DISTINCT ol.canonical_company_id) AS unique_customers
  FROM canonical_order_lines ol
  WHERE ol.order_type='sale'
    AND ol.order_state IN ('sale','done')
    AND ol.order_date >= CURRENT_DATE - interval '365 days'
  GROUP BY 1
)
SELECT
  cp.id                              AS canonical_product_id,
  cp.internal_ref,
  cp.display_name,
  cp.category,
  cp.standard_price_mxn,
  cp.list_price_mxn,
  cp.stock_qty,
  cp.available_qty,
  cp.is_active,
  COALESCE(o.revenue_mxn, 0)         AS odoo_revenue_12m_mxn,
  COALESCE(o.units_sold, 0)          AS units_sold_12m,
  COALESCE(o.unique_customers, 0)    AS unique_customers_12m,
  cp.sat_revenue_mxn_12m             AS sat_revenue_12m_mxn,
  cp.margin_pct_12m,
  cp.top_customers_canonical_ids,
  cp.top_suppliers_canonical_ids,
  cp.sat_clave_prod_serv,
  cp.fiscal_map_confidence,
  now()                              AS refreshed_at
FROM canonical_products cp
LEFT JOIN odoo_12m o ON o.pid = cp.id;

-- ===== schema_changes (4 rows) =======================================
INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE_VIEW', 'gold_pl_statement', 'Gold: P&L per period (dot separator)',
       'supabase/migrations/1062_silver_sp4_gold_finance_product.sql', 'silver-sp4-task-22', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes
                  WHERE triggered_by='silver-sp4-task-22' AND table_name='gold_pl_statement');

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE_VIEW', 'gold_balance_sheet', 'Gold: balance sheet per period',
       'supabase/migrations/1062_silver_sp4_gold_finance_product.sql', 'silver-sp4-task-22', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes
                  WHERE triggered_by='silver-sp4-task-22' AND table_name='gold_balance_sheet');

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE_VIEW', 'gold_cashflow', 'Gold: cashflow snapshot',
       'supabase/migrations/1062_silver_sp4_gold_finance_product.sql', 'silver-sp4-task-22', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes
                  WHERE triggered_by='silver-sp4-task-22' AND table_name='gold_cashflow');

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE_VIEW', 'gold_product_performance', 'Gold: product performance',
       'supabase/migrations/1062_silver_sp4_gold_finance_product.sql', 'silver-sp4-task-22', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes
                  WHERE triggered_by='silver-sp4-task-22' AND table_name='gold_product_performance');

COMMIT;
