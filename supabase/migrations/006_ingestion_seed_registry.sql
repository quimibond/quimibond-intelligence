-- supabase/migrations/006_ingestion_seed_registry.sql
-- Fase 0 Plan 1: initial source_registry for the two critical tables

insert into ingestion.source_registry
  (source_id, table_name, entity_kind, sla_minutes, priority, owner_agent, reconciliation_window_days, is_active)
values
  ('odoo','odoo_invoices','invoice',60,'critical','finance',30,true),
  ('odoo','odoo_payments','payment',60,'critical','finance',30,true)
on conflict (source_id, table_name) do update set
  entity_kind = excluded.entity_kind,
  sla_minutes = excluded.sla_minutes,
  priority = excluded.priority,
  owner_agent = excluded.owner_agent,
  reconciliation_window_days = excluded.reconciliation_window_days,
  is_active = excluded.is_active;
