-- SP1 final: snapshot post drops
INSERT INTO public.audit_runs (run_id, invariant_key, severity, source, model, details, run_at)
SELECT
  gen_random_uuid(),
  'sp1_final',
  'ok',
  'supabase',
  'final',
  jsonb_build_object(
    'total_views', (SELECT count(*) FROM pg_views WHERE schemaname='public'),
    'total_mvs', (SELECT count(*) FROM pg_matviews WHERE schemaname='public'),
    'total_tables', (SELECT count(*) FROM pg_tables WHERE schemaname='public'),
    'total_fns', (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace),
    'sp1_views_dropped', 8,
    'sp1_mvs_dropped', 5,
    'sp1_tables_dropped', 5,
    'sp1_deferred_migrate_first', jsonb_build_array('action_items','agent_tickets','notification_queue','health_scores'),
    'sp1_keep_permanent_overrides', jsonb_build_array('syntage_webhook_events','odoo_snapshots','cashflow_journal_classification'),
    'sp1_total_objects_dropped', 18
  ),
  now();
