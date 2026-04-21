-- supabase/migrations/1046_silver_sp4_canonical_manufacturing.sql
--
-- Silver SP4 — Task 7: canonical_manufacturing MV
-- Spec §5.14; Plan Task 7. Volume: ~4,713 rows.

BEGIN;

DROP MATERIALIZED VIEW IF EXISTS canonical_manufacturing CASCADE;

CREATE MATERIALIZED VIEW canonical_manufacturing AS
SELECT
  m.id                                   AS canonical_id,
  m.odoo_production_id,
  m.name,
  cp.id                                  AS canonical_product_id,
  m.product_name,
  m.odoo_product_id,
  m.qty_planned,
  m.qty_produced,
  CASE WHEN m.qty_planned > 0
       THEN ROUND(100.0 * m.qty_produced / m.qty_planned, 2)
       END                               AS yield_pct,
  m.state,
  m.date_start,
  m.date_finished,
  m.create_date,
  CASE WHEN m.date_finished IS NOT NULL AND m.date_start IS NOT NULL
       THEN EXTRACT(EPOCH FROM (m.date_finished - m.date_start)) / 86400
       END                               AS cycle_time_days,
  m.assigned_user,
  m.origin,
  m.odoo_company_id,
  now()                                  AS refreshed_at
FROM odoo_manufacturing m
LEFT JOIN canonical_products cp ON cp.odoo_product_id = m.odoo_product_id;

CREATE UNIQUE INDEX canonical_manufacturing_pk ON canonical_manufacturing (canonical_id);
CREATE INDEX canonical_manufacturing_state_idx ON canonical_manufacturing (state);
CREATE INDEX canonical_manufacturing_product_idx ON canonical_manufacturing (canonical_product_id);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE_MV', 'canonical_manufacturing', 'Pattern B MV over odoo_manufacturing',
       'supabase/migrations/1046_silver_sp4_canonical_manufacturing.sql',
       'silver-sp4-task-7', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by = 'silver-sp4-task-7');

COMMIT;
