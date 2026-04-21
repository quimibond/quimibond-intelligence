BEGIN;

-- SP2 Task 15a: Register 10 invariants in audit_tolerances
-- abs_tolerance and pct_tolerance are NOT NULL; use 0 for boolean/flag invariants

INSERT INTO audit_tolerances (invariant_key, abs_tolerance, pct_tolerance, notes, severity_default, entity, enabled, auto_resolve, check_cadence)
VALUES
  ('invoice.amount_mismatch',                   0.50,  0.005, 'amount_total_odoo vs amount_total_sat',        'high',     'invoice',     true, true,  'hourly'),
  ('invoice.state_mismatch_posted_cancelled',   0,     0,     'Odoo posted + SAT cancelado',                  'high',     'invoice',     true, true,  'hourly'),
  ('invoice.state_mismatch_cancel_vigente',     0,     0,     'Odoo cancel + SAT vigente — escalate',          'critical', 'invoice',     true, false, 'hourly'),
  ('invoice.date_drift',                        3.0,   0,     '|invoice_date - fecha_emision| > 3d',          'medium',   'invoice',     true, false, '2h'),
  ('invoice.pending_operationalization',        0,     0,     'CFDI post-2021 sin Odoo',                       'medium',   'invoice',     true, true,  '2h'),
  ('invoice.missing_sat_timbrado',              7.0,   0,     'Odoo posted sin CFDI >7d',                      'medium',   'invoice',     true, true,  'hourly'),
  ('invoice.posted_without_uuid',               0,     0,     'Odoo posted sin cfdi_uuid (post-addon-fix)',    'critical', 'invoice',     true, false, 'hourly'),
  ('invoice.credit_note_orphan',                0,     0,     'Egreso SAT sin related_invoice_canonical_id',   'medium',   'credit_note', true, false, '2h'),
  ('payment.registered_without_complement',     30.0,  0,     'Odoo paid PPD sin complemento >30d',            'high',     'payment',     true, true,  '2h'),
  ('payment.complement_without_payment',        30.0,  0,     'Complemento SAT sin Odoo >30d',                 'high',     'payment',     true, true,  '2h')
ON CONFLICT (invariant_key) DO UPDATE SET
  severity_default = EXCLUDED.severity_default,
  entity           = EXCLUDED.entity,
  enabled          = EXCLUDED.enabled,
  auto_resolve     = EXCLUDED.auto_resolve,
  check_cadence    = EXCLUDED.check_cadence,
  abs_tolerance    = EXCLUDED.abs_tolerance,
  pct_tolerance    = EXCLUDED.pct_tolerance,
  notes            = EXCLUDED.notes;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('config', 'audit_tolerances', 'SP2 Task 15a: register 10 invariants', '20260422_sp2_15a_invariants_register.sql', 'silver-sp2', true);

COMMIT;
