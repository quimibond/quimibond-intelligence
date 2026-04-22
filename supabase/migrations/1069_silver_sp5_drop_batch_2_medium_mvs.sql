-- Migration: 1069_silver_sp5_drop_batch_2_medium_mvs
-- SP5 Task 28 — rename Batch 2 medium legacy MVs to _deprecated_sp5
--   + rewrite refresh_all_matviews() as a defensive pg_class loop
--
-- Excluded from batch:
--   company_profile         — KEEP consumers: cash_flow_aging, client_reorder_predictions,
--                             payment_predictions, weekly_trends (all KEEP-list objects)
--   cross_director_signals  — already absent from DB (pre-dropped)
--
-- Renamed (5 objects):
--   company_profile_sat         → company_profile_sat_deprecated_sp5
--   company_email_intelligence  → company_email_intelligence_deprecated_sp5
--   company_handlers            → company_handlers_deprecated_sp5
--   company_insight_history     → company_insight_history_deprecated_sp5
--   company_narrative           → company_narrative_deprecated_sp5

BEGIN;

DO $$
DECLARE
  obj RECORD;
  candidates text[] := ARRAY[
    'company_profile_sat',
    'company_email_intelligence',
    'company_handlers',
    'company_insight_history',
    'company_narrative',
    'cross_director_signals'
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
    END LOOP;
  END LOOP;
END $$;

-- Defensive rewrite of refresh_all_matviews:
--   - Loops over pg_class (picks up new MVs automatically)
--   - Skips _deprecated_sp5 objects
--   - Per-MV error swallowing: tries CONCURRENT first, falls back to non-concurrent, logs errors
--   - Preserves jsonb return type (cron job discards result; no callers check shape)
CREATE OR REPLACE FUNCTION refresh_all_matviews() RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_log     jsonb := '[]'::jsonb;
  mv        RECORD;
BEGIN
  FOR mv IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='m'
      AND c.relname NOT LIKE '%\_deprecated\_sp5' ESCAPE '\'
    ORDER BY c.relname
  LOOP
    BEGIN
      EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY public.%I', mv.relname);
      v_log := v_log || jsonb_build_object('mv', mv.relname, 'status', 'ok');
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        EXECUTE format('REFRESH MATERIALIZED VIEW public.%I', mv.relname);
        v_log := v_log || jsonb_build_object('mv', mv.relname, 'status', 'ok_non_concurrent');
      EXCEPTION WHEN OTHERS THEN
        -- swallow per-MV errors; continue
        v_log := v_log || jsonb_build_object('mv', mv.relname, 'status', 'error', 'err', SQLERRM);
      END;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'started_at',  v_started,
    'finished_at', clock_timestamp(),
    'results',     v_log
  );
END $$;

INSERT INTO audit_runs (run_id, run_at, source, model, invariant_key, bucket_key, severity, details)
VALUES (gen_random_uuid(), now(), 'supabase', 'silver_sp5', 'sp5.task28', 'sp5_task28_drop_batch_2', 'ok',
  jsonb_build_object('label','sp5_task28_drop_batch_2_renamed',
    'candidates', 6,
    'renamed', 5,
    'skipped_absent', 1,
    'excluded_keep_consumer', jsonb_build_array('company_profile'),
    'refresh_all_matviews_rewritten', true));

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'RENAME_TABLE','multiple',
  'Batch 2 medium MVs renamed _deprecated_sp5 + refresh_all_matviews defensive rewrite (pg_class loop, skips _deprecated_sp5)',
  'ALTER MATERIALIZED VIEW company_profile_sat RENAME TO company_profile_sat_deprecated_sp5; ... CREATE OR REPLACE FUNCTION refresh_all_matviews() ...',
  'silver-sp5-task-28', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by='silver-sp5-task-28');

COMMIT;
