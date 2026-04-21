-- SP1 baseline: snapshot before audit + prune pass
-- Captured 2026-04-20 before SP1 audit+prune execution
--
-- Baseline counts:
--   total_views:  77
--   total_mvs:    39
--   total_tables: 77
--   total_fns:    312
--
-- Named drop candidates present:
--   named_views_present (§12.1):   2  (analytics_customer_360, analytics_supplier_360)
--   named_mvs_candidates (§12.2):  6
--   named_tables_candidates (§12.3): 9 of 11 (director_analysis_actions + document_extractions already gone)
--
-- Table row counts for archiving decisions:
--   action_items:                    4,312
--   agent_tickets:                   1,958
--   briefings:                          48
--   cashflow_journal_classification:    10
--   director_analysis_runs:             35
--   health_scores:                  52,152
--   notification_queue:                815
--   pipeline_logs:                  33,371
--   syntage_webhook_events:         83,334

INSERT INTO public.audit_runs (run_id, invariant_key, severity, source, model, details, run_at)
SELECT
  gen_random_uuid(),
  'sp1_baseline',
  'ok',
  'supabase',
  'baseline',
  jsonb_build_object(
    'total_views', (SELECT count(*) FROM pg_views WHERE schemaname='public'),
    'total_mvs', (SELECT count(*) FROM pg_matviews WHERE schemaname='public'),
    'total_tables', (SELECT count(*) FROM pg_tables WHERE schemaname='public'),
    'total_fns', (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace),
    'agent_tickets_rows', (SELECT count(*) FROM agent_tickets),
    'notification_queue_rows', (SELECT count(*) FROM notification_queue),
    'health_scores_rows', (SELECT count(*) FROM health_scores),
    'director_analysis_runs_rows', (SELECT count(*) FROM director_analysis_runs),
    'syntage_webhook_events_rows', (SELECT count(*) FROM syntage_webhook_events),
    'pipeline_logs_rows', (SELECT count(*) FROM pipeline_logs),
    'action_items_rows', (SELECT count(*) FROM action_items),
    'briefings_rows', (SELECT count(*) FROM briefings),
    'cashflow_journal_classification_rows', (SELECT count(*) FROM cashflow_journal_classification),
    'director_analysis_actions_exists', false,
    'document_extractions_exists', false
  ),
  now();
