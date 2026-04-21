BEGIN;

-- Drop views in dependency order (invoice_bridge before unified_invoices)
-- analytics_supplier_360 already absent — IF EXISTS handles it safely
DROP VIEW IF EXISTS public.analytics_supplier_360;
DROP VIEW IF EXISTS public.unified_payment_allocations;
DROP VIEW IF EXISTS public.orders_unified;
DROP VIEW IF EXISTS public.order_fulfillment_bridge;
DROP VIEW IF EXISTS public.person_unified;
DROP VIEW IF EXISTS public.balance_sheet;
DROP VIEW IF EXISTS public.monthly_revenue_trend;
DROP VIEW IF EXISTS public.invoice_bridge;       -- drop before unified_invoices (it depends on it)
DROP VIEW IF EXISTS public.unified_invoices;

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed) VALUES
  ('drop_view', 'analytics_supplier_360',      'SP1 — thin wrapper, 0 callers (was already absent)', 'DROP VIEW IF EXISTS'),
  ('drop_view', 'unified_payment_allocations',  'SP1 — 0 callers', 'DROP VIEW'),
  ('drop_view', 'orders_unified',               'SP1 — 0 callers', 'DROP VIEW'),
  ('drop_view', 'order_fulfillment_bridge',     'SP1 — 0 callers', 'DROP VIEW'),
  ('drop_view', 'person_unified',               'SP1 — 0 callers', 'DROP VIEW'),
  ('drop_view', 'balance_sheet',                'SP1 — Fase 2.6 created but data gap upstream, 0 callers', 'DROP VIEW'),
  ('drop_view', 'monthly_revenue_trend',        'SP1 — 0 callers, deferred SP4 consolidation (monthly_revenue_by_company MV kept)', 'DROP VIEW'),
  ('drop_view', 'invoice_bridge',               'SP1 — superseded by canonical_invoices (SP2); reconcile_invoice_manually fn uses invoice_bridge_manual not this view', 'DROP VIEW'),
  ('drop_view', 'unified_invoices',             'SP1 — superseded by canonical_invoices (SP2), 0 frontend callers', 'DROP VIEW');

COMMIT;
