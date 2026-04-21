-- supabase/migrations/1055_silver_sp4_new_invariants_catalog.sql
--
-- Silver SP4 — Task 16: register 22 new invariants + remap legacy NULL invariant_key
-- Spec §9.2; Plan Task 16.
-- New invariants land disabled (enabled=false) — Task 18 flips them on.
-- Note: abs_tolerance/pct_tolerance are NOT NULL with defaults 0.01/0.001.
--       Rows with no meaningful numeric bound use the column defaults.

BEGIN;

-- ===== invariant catalog =============================================
INSERT INTO audit_tolerances
  (invariant_key, abs_tolerance, pct_tolerance, notes, severity_default, entity, enabled, auto_resolve, check_cadence)
VALUES
  -- invoice group
  ('invoice.amount_diff_post_fx',       0.01, 1.00,  'diff persists after tipo_cambio SAT; real (non-FX) amount diff',
    'medium',   'invoice',       false, false, '2h'),
  ('invoice.uuid_mismatch_rfc',         0.01, 0.001, 'UUID match but emisor/receptor RFC differs — integrity breach',
    'critical', 'invoice',       false, false, 'hourly'),
  -- payment group
  ('payment.amount_mismatch',           0.01, 0.001, 'Odoo amount vs SAT amount diff > 0.01 MXN',
    'high',     'payment',       false, true,  'hourly'),
  ('payment.date_mismatch',             1,    0.001, '|date_odoo - fecha_pago_sat| > 1 day',
    'low',      'payment',       false, true,  '2h'),
  ('payment.allocation_over',           0.01, 0.001, 'sum(allocated) > amount_resolved',
    'medium',   'payment',       false, false, '2h'),
  ('payment.allocation_under',          0.01, 0.001, 'sum(allocated) < amount_resolved on active PPD',
    'low',      'payment',       false, true,  '2h'),
  -- tax group
  ('tax.retention_accounting_drift',    1.00, 0.05,  'SUM retention vs Odoo ISR retenido monthly',
    'medium',   'tax_event',     false, false, 'daily'),
  ('tax.return_payment_missing',        0.01, 0.001, 'syntage_tax_returns.monto_pagado>0 w/o Odoo account.payment',
    'high',     'tax_event',     false, true,  'daily'),
  ('tax.accounting_sat_drift',          1.00, 0.05,  'odoo_account_balances vs syntage_electronic_accounting',
    'medium',   'tax_event',     false, false, 'daily'),
  ('tax.blacklist_69b_definitive_active', 0.01, 0.001, 'Counterparty blacklist=definitive with post-flag CFDI',
    'critical', 'company',       false, false, 'hourly'),
  -- order group
  ('order.orphan_invoicing',            0.01, 0.001, 'SO line sale/done with qty_pending_invoice aging > 30d',
    'medium',   'order_line',    false, true,  'daily'),
  ('order.orphan_delivery',             0.01, 0.001, 'SO line sale/done with qty_pending_delivery aging > 14d',
    'medium',   'order_line',    false, true,  'daily'),
  ('invoice.without_order',             0.01, 0.001, 'invoice posted whose ref/origin does not match any SO/PO',
    'low',      'invoice',       false, false, 'daily'),
  -- delivery / mfg / line
  ('delivery.late_active',              0.01, 0.001, 'is_late AND state NOT IN (done,cancel)',
    'medium',   'delivery',      false, true,  '2h'),
  ('mfg.stock_drift',                   0.01, 0.001, 'qty_produced closed without stock_qty reflection',
    'medium',   'manufacturing', false, false, 'daily'),
  ('line_price_mismatch',               0.01, 0.50,  'odoo_invoice_lines.price_unit vs syntage valor_unitario diff',
    'medium',   'invoice_line',  false, false, 'daily'),
  -- inventory / product / entity
  ('orderpoint_untuned',                0.01, 0.001, 'orderpoint min=0 and qty_to_order>0',
    'low',      'inventory',     false, false, 'daily'),
  ('clave_prodserv_drift',              0.01, 0.001, 'most-frequent claveProdServ changes month-over-month',
    'low',      'product',       false, false, 'daily'),
  ('entity_unresolved_30d',             30,   0.001, 'entity KG with mention_count>3 without canonical link for 30d',
    'low',      'company',       false, true,  'daily'),
  ('ambiguous_match',                   0.01, 0.001, 'matcher found 2+ candidates for same source row',
    'high',     'any',           false, false, '2h'),
  -- bank / fx
  ('bank_balance.stale',                48,   0.001, 'bank updated_at older than 48h',
    'medium',   'bank_balance',  false, true,  'hourly'),
  ('fx_rate.stale',                     3,    0.001, 'MAX(rate_date) < today-3d',
    'high',     'fx_rate',       false, true,  'hourly')
ON CONFLICT (invariant_key) DO NOTHING;

-- ===== legacy invariant_key backfill ================================
UPDATE reconciliation_issues SET invariant_key = issue_type
WHERE invariant_key IS NULL
  AND issue_type IN (
    'invoice.posted_without_uuid',
    'invoice.missing_sat_timbrado',
    'invoice.pending_operationalization',
    'invoice.amount_mismatch',
    'invoice.state_mismatch_posted_cancelled',
    'invoice.state_mismatch_cancel_vigente',
    'invoice.date_drift',
    'invoice.credit_note_orphan',
    'payment.registered_without_complement',
    'payment.complement_without_payment'
  );

UPDATE reconciliation_issues SET invariant_key = 'payment.registered_without_complement'
WHERE invariant_key IS NULL AND issue_type IN ('payment_missing_complemento','registered_without_complement');

UPDATE reconciliation_issues SET invariant_key = 'payment.complement_without_payment'
WHERE invariant_key IS NULL AND issue_type IN ('complemento_missing_payment','complement_without_payment','sat_only_cfdi_issued','sat_only_cfdi_received');

UPDATE reconciliation_issues SET invariant_key = 'invoice.posted_without_uuid'
WHERE invariant_key IS NULL AND issue_type IN ('posted_but_sat_uncertified','posted_without_uuid');

UPDATE reconciliation_issues SET invariant_key = 'invoice.state_mismatch_posted_cancelled'
WHERE invariant_key IS NULL AND issue_type IN ('cancelled_but_posted','state_mismatch');

UPDATE reconciliation_issues SET invariant_key = 'invoice.amount_mismatch'
WHERE invariant_key IS NULL AND issue_type IN ('amount_mismatch');

UPDATE reconciliation_issues SET invariant_key = 'tax.blacklist_69b_definitive_active'
WHERE invariant_key IS NULL AND issue_type IN ('partner_blacklist_69b','blacklist_69b','blacklist_definitive');

-- Any remaining NULLs → sentinel for Data Quality agent to triage
UPDATE reconciliation_issues SET invariant_key = 'legacy.unclassified'
WHERE invariant_key IS NULL;

INSERT INTO audit_tolerances
  (invariant_key, notes, severity_default, entity, enabled, auto_resolve, check_cadence)
VALUES
  ('legacy.unclassified', 'Legacy SP1 issues with no mappable issue_type. Data Quality agent triages.',
   'low', 'legacy', false, false, 'daily')
ON CONFLICT (invariant_key) DO NOTHING;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'SEED', 'audit_tolerances',
       'Register 22 new invariants (all enabled=false until Task 18) + remap legacy invariant_key',
       'supabase/migrations/1055_silver_sp4_new_invariants_catalog.sql',
       'silver-sp4-task-16', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by = 'silver-sp4-task-16');

COMMIT;
