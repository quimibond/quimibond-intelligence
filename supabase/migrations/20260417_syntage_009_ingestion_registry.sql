-- Syntage Fase 1 · Migration 009 — register Syntage sources in ingestion core

INSERT INTO ingestion.source_registry
  (source_id, table_name, entity_kind, sla_minutes, priority, owner_agent,
   reconciliation_window_days, is_active)
VALUES
  ('syntage', 'syntage_invoices',              'invoice',          15,    'critical',  'finance', 30,  true),
  ('syntage', 'syntage_invoice_line_items',    'invoice_line',     15,    'important', 'finance', 30,  true),
  ('syntage', 'syntage_invoice_payments',      'payment_cfdi',     15,    'critical',  'finance', 30,  true),
  ('syntage', 'syntage_tax_retentions',        'retention_cfdi',   60,    'important', 'finance', 90,  true),
  ('syntage', 'syntage_tax_returns',           'tax_return',       1440,  'important', 'risk',    365, true),
  ('syntage', 'syntage_tax_status',            'tax_status',       1440,  'important', 'risk',    90,  true),
  ('syntage', 'syntage_electronic_accounting', 'eaccounting',      10080, 'context',   'risk',    365, true)
ON CONFLICT (source_id, table_name) DO UPDATE SET
  sla_minutes                 = EXCLUDED.sla_minutes,
  priority                    = EXCLUDED.priority,
  owner_agent                 = EXCLUDED.owner_agent,
  reconciliation_window_days  = EXCLUDED.reconciliation_window_days,
  is_active                   = EXCLUDED.is_active;
