-- supabase/migrations/1044_silver_sp4_canonical_deliveries.sql
--
-- Silver SP4 — Task 5: canonical_deliveries MV
-- Spec §5.12; Plan Task 5.
-- Volume: ~25,187 rows. Idempotent.

BEGIN;

DROP MATERIALIZED VIEW IF EXISTS canonical_deliveries CASCADE;

CREATE MATERIALIZED VIEW canonical_deliveries AS
SELECT
  d.id                               AS canonical_id,
  d.odoo_picking_id,
  d.name,
  d.odoo_partner_id,
  cc.id                              AS canonical_company_id,
  d.picking_type,
  d.picking_type_code,
  d.origin,
  d.scheduled_date,
  d.date_done,
  d.create_date,
  d.state,
  d.is_late,
  d.lead_time_days,
  d.odoo_company_id,
  now() AS refreshed_at
FROM odoo_deliveries d
LEFT JOIN canonical_companies cc ON cc.odoo_partner_id = d.odoo_partner_id;

CREATE UNIQUE INDEX canonical_deliveries_pk
  ON canonical_deliveries (canonical_id);
CREATE INDEX canonical_deliveries_company_idx
  ON canonical_deliveries (canonical_company_id);
CREATE INDEX canonical_deliveries_type_state_idx
  ON canonical_deliveries (picking_type_code, state);
CREATE INDEX canonical_deliveries_sched_idx
  ON canonical_deliveries (scheduled_date);
CREATE INDEX canonical_deliveries_late_idx
  ON canonical_deliveries (is_late) WHERE is_late = true;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE_MV', 'canonical_deliveries', 'Pattern B MV over odoo_deliveries',
       'supabase/migrations/1044_silver_sp4_canonical_deliveries.sql',
       'silver-sp4-task-5', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by = 'silver-sp4-task-5');

COMMIT;
