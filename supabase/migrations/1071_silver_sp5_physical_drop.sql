-- Migration: 1071_silver_sp5_physical_drop
-- Physical DROP of Batches 1+2 (_deprecated_sp5) + Batch 3 (large MVs + dead tables).
-- IRREVERSIBLE. User confirmed proceed on 2026-04-22.
--
-- Pre-drop caller check passed (0 live frontend callers) after retiring:
--   - health_scores: orchestrate → Promise.resolve({data:[]}), health-scores route → 410
--   - agent_tickets: orchestrate dedup insert → noop, cross-cutting select → Promise.resolve({data:[]})
--   - notification_queue: system.ts → stub empty
--   - reconciliation_summary_daily: briefing/route.ts → null stubs
--   - invoices_unified: 3 test files → describe.skip, refresh-unified route → 410
--
-- CASCADE consumers that will also be dropped (both are legacy views, no frontend callers):
--   - payment_allocations_unified (view depending on invoices_unified + payments_unified)
--   - snapshot_changes (view depending on odoo_snapshots)

BEGIN;

-- Rename Batch 3 to _deprecated_sp5 first (so all drops are uniform)
DO $$
DECLARE
  obj RECORD;
  candidates text[] := ARRAY[
    'invoices_unified','payments_unified','syntage_invoices_enriched','products_unified',
    'health_scores','agent_tickets','notification_queue','reconciliation_summary_daily',
    'invoice_bridge_manual','payment_bridge_manual','products_fiscal_map',
    'unified_refresh_queue','odoo_schema_catalog','odoo_uoms','odoo_snapshots'
  ];
  nm text;
BEGIN
  FOREACH nm IN ARRAY candidates LOOP
    FOR obj IN
      SELECT c.relname, c.relkind
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname = nm
    LOOP
      EXECUTE format('ALTER %s public.%I RENAME TO %I',
        CASE obj.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END,
        obj.relname, obj.relname || '_deprecated_sp5');
      RAISE NOTICE 'Batch 3 renamed % → %', obj.relname, obj.relname || '_deprecated_sp5';
    END LOOP;
  END LOOP;
END $$;

-- Physical DROP of all _deprecated_sp5 objects (batches 1+2+3)
DO $$
DECLARE
  obj RECORD;
BEGIN
  FOR obj IN
    SELECT c.relname, c.relkind
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname LIKE '%_deprecated_sp5'
    -- DROP views first (dependency-safe for MVs); then MVs; then tables
    ORDER BY CASE c.relkind WHEN 'v' THEN 1 WHEN 'm' THEN 2 WHEN 'r' THEN 3 ELSE 4 END
  LOOP
    EXECUTE format('DROP %s IF EXISTS public.%I CASCADE',
      CASE obj.relkind
        WHEN 'v' THEN 'VIEW'
        WHEN 'm' THEN 'MATERIALIZED VIEW'
        WHEN 'r' THEN 'TABLE'
        ELSE 'VIEW'
      END,
      obj.relname);
    RAISE NOTICE 'Dropped % %', obj.relkind, obj.relname;
  END LOOP;
END $$;

INSERT INTO audit_runs (run_id, run_at, source, model, invariant_key, bucket_key, severity, details)
VALUES (gen_random_uuid(), now(), 'supabase', 'silver_sp5', 'sp5.task29', 'sp5_task29_physical_drop', 'ok',
  jsonb_build_object('label','sp5_task29_physical_drop_complete',
    'dropped_remaining', (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE '%_deprecated_sp5')));

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'DROP','multiple',
  'Physical DROP of all _deprecated_sp5 objects (batches 1+2+3 per §12)',
  'DROP VIEW/MV/TABLE IF EXISTS ... CASCADE for every _deprecated_sp5 object',
  'silver-sp5-task-29', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by='silver-sp5-task-29');

COMMIT;
