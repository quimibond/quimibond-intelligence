-- supabase/migrations/1048_silver_sp4_canonical_fx_rates.sql
--
-- Silver SP4 — Task 9: canonical_fx_rates VIEW + usd_to_mxn(date) helper
-- Spec §5.16; Plan Task 9.

BEGIN;

DROP VIEW IF EXISTS canonical_fx_rates;

CREATE VIEW canonical_fx_rates AS
SELECT
  cr.id                            AS canonical_id,
  cr.currency,
  cr.rate,
  cr.inverse_rate,
  cr.rate_date,
  cr.odoo_company_id,
  cr.synced_at,
  CASE WHEN cr.rate_date < CURRENT_DATE - interval '3 days'
       THEN true ELSE false END    AS is_stale,
  ROW_NUMBER() OVER (PARTITION BY cr.currency
                     ORDER BY cr.rate_date DESC) AS recency_rank
FROM odoo_currency_rates cr;

DROP FUNCTION IF EXISTS usd_to_mxn() CASCADE;
DROP FUNCTION IF EXISTS usd_to_mxn(date) CASCADE;

CREATE OR REPLACE FUNCTION usd_to_mxn(p_date date DEFAULT CURRENT_DATE)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT rate
  FROM canonical_fx_rates
  WHERE currency = 'USD' AND rate_date <= p_date
  ORDER BY rate_date DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION usd_to_mxn(date) IS
  'Silver SP4: USD→MXN rate as of p_date. Defaults to CURRENT_DATE.';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE_VIEW', 'canonical_fx_rates', 'Pattern B view + usd_to_mxn(date) helper',
       'supabase/migrations/1048_silver_sp4_canonical_fx_rates.sql',
       'silver-sp4-task-9', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by = 'silver-sp4-task-9');

COMMIT;
