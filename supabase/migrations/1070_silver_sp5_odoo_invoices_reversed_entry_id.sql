-- Migration: 1070_silver_sp5_odoo_invoices_reversed_entry_id
-- Adds reversed_entry_id to odoo_invoices so canonical_credit_notes can link
-- NC → factura origen via Odoo's reversed_entry_id field (pre-SAT fallback).
-- Supports SP5 §14.3 of 2026-04-21-silver-architecture.md.

ALTER TABLE odoo_invoices ADD COLUMN IF NOT EXISTS reversed_entry_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_odoo_invoices_reversed_entry_id ON odoo_invoices (reversed_entry_id);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'ADD_COLUMN','odoo_invoices',
  'Add reversed_entry_id + index to support canonical_credit_notes NC→factura linkage (SP5 §14.3)',
  'ALTER TABLE odoo_invoices ADD COLUMN IF NOT EXISTS reversed_entry_id BIGINT; CREATE INDEX IF NOT EXISTS idx_odoo_invoices_reversed_entry_id ON odoo_invoices (reversed_entry_id);',
  'silver-sp5-task-22', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by='silver-sp5-task-22');
