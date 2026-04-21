BEGIN;

-- Drop tables with 0 callers (user D2 approved)
-- SKIPPED: action_items — active INSERT/UPDATE writers in orchestrate + pipeline routes
-- SKIPPED: syntage_webhook_events — active readers (webhook-events.ts, idempotency.ts) + writers (webhook route)
-- SKIPPED: odoo_snapshots — snapshot_changes view depends on it + 2 DB fns use it
-- SKIPPED: cashflow_journal_classification — cashflow_current_cash VIEW actively depends on it (KEEP view)

DROP TABLE IF EXISTS public.unified_refresh_queue;
DROP TABLE IF EXISTS public.odoo_schema_catalog;
DROP TABLE IF EXISTS public.odoo_uoms;
DROP TABLE IF EXISTS public.odoo_invoices_archive_pre_dedup;
DROP TABLE IF EXISTS public.director_analysis_runs;

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed) VALUES
  ('drop_table', 'unified_refresh_queue',          'SP1 — 0 frontend callers, only vestigial trg_schedule_unified_refresh trigger fn', 'DROP TABLE'),
  ('drop_table', 'odoo_schema_catalog',             'SP1 — 0 callers, 3820 rows, debug artifact', 'DROP TABLE'),
  ('drop_table', 'odoo_uoms',                       'SP1 — 0 callers, 76 rows, unused sync target', 'DROP TABLE'),
  ('drop_table', 'odoo_invoices_archive_pre_dedup', 'SP1 — 0 callers, 5321 rows, old dedup archive superseded by _dup_cfdi_uuid archive', 'DROP TABLE'),
  ('drop_table', 'director_analysis_runs',          'SP1 — 0 callers, 35 rows, abandoned worker pipeline', 'DROP TABLE');

-- Notes on SKIPped items (concerns for user):
-- action_items: ACTIVE writers in orchestrate/route.ts:589, pipeline/analyze/route.ts:441,
--   pipeline/reconcile/route.ts (UPDATE x4). 4312 rows. → Reclassified MIGRATE FIRST (SP5).
-- syntage_webhook_events: ACTIVE callers in idempotency.ts, webhook-events.ts, health/route.ts.
--   83K rows. → KEEP (reclassify from plan).
-- odoo_snapshots: snapshot_changes view dep + get_company_full_context + take_daily_snapshot.
--   → KEEP (reclassify from plan).
-- cashflow_journal_classification: cashflow_current_cash VIEW joins it for bucket classification.
--   cashflow_current_cash is KEEP (active via RPC + dep chain to cashflow_liquidity_metrics).
--   → KEEP (reclassify from plan — 10 seeded rows, active lookup).

COMMIT;
