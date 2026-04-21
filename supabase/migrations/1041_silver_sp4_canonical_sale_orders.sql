-- supabase/migrations/1041_silver_sp4_canonical_sale_orders.sql
--
-- Silver SP4 — Task 2: canonical_sale_orders MV
-- Spec §5.9; Plan Task 2.
--
-- Idempotent: drops + recreates the MV (rows are all derived from Bronze; no loss).

BEGIN;

DROP MATERIALIZED VIEW IF EXISTS canonical_sale_orders CASCADE;

CREATE MATERIALIZED VIEW canonical_sale_orders AS
SELECT
  so.id                               AS canonical_id,
  so.odoo_order_id,
  so.name,
  so.odoo_partner_id,
  cc.id                               AS canonical_company_id,
  so.salesperson_name,
  so.salesperson_email,
  so.salesperson_user_id,
  cct.id                              AS salesperson_canonical_contact_id,
  so.team_name,
  so.amount_total,
  so.amount_untaxed,
  so.amount_total_mxn,
  so.amount_untaxed_mxn,
  so.margin,
  so.margin_percent,
  so.currency,
  so.state,
  so.date_order,
  so.commitment_date,
  so.create_date,
  so.odoo_company_id,
  CASE
    WHEN so.state IN ('sale','done')
     AND so.commitment_date IS NOT NULL
     AND so.commitment_date < CURRENT_DATE
    THEN true ELSE false
  END AS is_commitment_overdue,
  now() AS refreshed_at
FROM odoo_sale_orders so
LEFT JOIN canonical_companies cc ON cc.odoo_partner_id = so.odoo_partner_id
LEFT JOIN canonical_contacts cct ON cct.odoo_user_id   = so.salesperson_user_id;

CREATE UNIQUE INDEX canonical_sale_orders_pk
  ON canonical_sale_orders (canonical_id);
CREATE INDEX canonical_sale_orders_company_idx
  ON canonical_sale_orders (canonical_company_id);
CREATE INDEX canonical_sale_orders_salesperson_idx
  ON canonical_sale_orders (salesperson_canonical_contact_id);
CREATE INDEX canonical_sale_orders_state_date_idx
  ON canonical_sale_orders (state, date_order DESC);
CREATE INDEX canonical_sale_orders_overdue_idx
  ON canonical_sale_orders (is_commitment_overdue)
  WHERE is_commitment_overdue = true;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE_MV', 'canonical_sale_orders', 'Pattern B MV over odoo_sale_orders',
       'supabase/migrations/1041_silver_sp4_canonical_sale_orders.sql',
       'silver-sp4-task-2', true
WHERE NOT EXISTS (
  SELECT 1 FROM schema_changes WHERE triggered_by = 'silver-sp4-task-2'
);

COMMIT;
