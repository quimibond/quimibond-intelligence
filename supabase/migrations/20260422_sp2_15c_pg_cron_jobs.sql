BEGIN;

-- SP2 Task 15c: Register 3 pg_cron jobs for reconciliation automation
-- Idempotent: remove any existing SP2 jobs then re-create

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobname FROM cron.job WHERE jobname LIKE 'silver_sp2_%'
  LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

-- ── Job 1: Hourly reconciliation (check_cadence='hourly') ─────────────────
SELECT cron.schedule(
  'silver_sp2_reconcile_hourly',
  '5 * * * *',
  $cmd$
    DO $body$
    DECLARE k text;
    BEGIN
      FOR k IN
        SELECT invariant_key
        FROM   audit_tolerances
        WHERE  check_cadence = 'hourly'
          AND  enabled       = true
        ORDER BY invariant_key
      LOOP
        PERFORM run_reconciliation(k);
      END LOOP;
      PERFORM compute_priority_scores();
    END
    $body$;
  $cmd$
);

-- ── Job 2: 2-hour reconciliation (check_cadence='2h') ─────────────────────
SELECT cron.schedule(
  'silver_sp2_reconcile_2h',
  '15 */2 * * *',
  $cmd$
    DO $body$
    DECLARE k text;
    BEGIN
      FOR k IN
        SELECT invariant_key
        FROM   audit_tolerances
        WHERE  check_cadence = '2h'
          AND  enabled       = true
        ORDER BY invariant_key
      LOOP
        PERFORM run_reconciliation(k);
      END LOOP;
      PERFORM compute_priority_scores();
    END
    $body$;
  $cmd$
);

-- ── Job 3: Nightly full run + priority refresh ─────────────────────────────
SELECT cron.schedule(
  'silver_sp2_refresh_canonical_nightly',
  '30 3 * * *',
  $cmd$
    DO $body$
    BEGIN
      PERFORM run_reconciliation(NULL);
      PERFORM compute_priority_scores();
    END
    $body$;
  $cmd$
);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('cron_schedule', '', 'SP2 Task 15c: 3 pg_cron jobs (hourly/2h/nightly reconciliation)',
        '20260422_sp2_15c_pg_cron_jobs.sql', 'silver-sp2', true);

COMMIT;
