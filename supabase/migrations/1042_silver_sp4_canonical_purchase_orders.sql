-- supabase/migrations/1042_silver_sp4_canonical_purchase_orders.sql
--
-- Silver SP4 — Task 3: canonical_purchase_orders MV
-- Spec §5.10; Plan Task 3.
-- Idempotent: DROP + re-CREATE (derived from Bronze); schema_changes INSERT guarded by WHERE NOT EXISTS.

BEGIN;

DROP MATERIALIZED VIEW IF EXISTS canonical_purchase_orders CASCADE;

CREATE MATERIALIZED VIEW canonical_purchase_orders AS
SELECT
  po.id                               AS canonical_id,
  po.odoo_order_id,
  po.name,
  po.odoo_partner_id,
  cc.id                               AS canonical_company_id,
  po.buyer_name,
  po.buyer_email,
  po.buyer_user_id,
  cct.id                              AS buyer_canonical_contact_id,
  po.amount_total,
  po.amount_untaxed,
  po.amount_total_mxn,
  po.amount_untaxed_mxn,
  po.currency,
  po.state,
  po.date_order,
  po.date_approve,
  po.create_date,
  po.odoo_company_id,
  now() AS refreshed_at
FROM odoo_purchase_orders po
LEFT JOIN canonical_companies cc ON cc.odoo_partner_id = po.odoo_partner_id
LEFT JOIN canonical_contacts cct ON cct.odoo_user_id   = po.buyer_user_id;

CREATE UNIQUE INDEX canonical_purchase_orders_pk
  ON canonical_purchase_orders (canonical_id);
CREATE INDEX canonical_purchase_orders_company_idx
  ON canonical_purchase_orders (canonical_company_id);
CREATE INDEX canonical_purchase_orders_buyer_idx
  ON canonical_purchase_orders (buyer_canonical_contact_id);
CREATE INDEX canonical_purchase_orders_state_date_idx
  ON canonical_purchase_orders (state, date_order DESC);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE_MV', 'canonical_purchase_orders', 'Pattern B MV over odoo_purchase_orders',
       'supabase/migrations/1042_silver_sp4_canonical_purchase_orders.sql',
       'silver-sp4-task-3', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by = 'silver-sp4-task-3');

COMMIT;
