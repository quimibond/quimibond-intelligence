-- supabase/migrations/20260429_fix_sp12_cron_session_timeout.sql
--
-- Follow-up to 20260429_fix_sp12_refresh_mfg_cost_timeout.sql.
--
-- The earlier fix wrapped the two REFRESH calls into a function with
-- `SET statement_timeout='10min'` and pointed the cron at it via
-- `SELECT public.sp12_refresh_mfg_cost_mvs();`.
--
-- FIRST POST-FIX RUN STILL FAILED at 2026-04-29 20:00 UTC (121s — exactly
-- the 2min default). Function body's `SET statement_timeout` only applies
-- inside the function; the OUTER `SELECT func();` call inherits the cron
-- session's session-level statement_timeout (default 2min).
--
-- FIX
-- Add a `SET statement_timeout='10min'` statement BEFORE the function
-- call inside the cron command itself. That way the cron session enters
-- with a 10min budget, the outer SELECT respects it, and the function
-- body inherits the same value.

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'sp12_refresh_mfg_cost_mvs_hourly';

  IF v_jobid IS NULL THEN
    RAISE NOTICE 'sp12_refresh_mfg_cost_mvs_hourly cron not found';
  ELSE
    PERFORM cron.alter_job(
      job_id  := v_jobid,
      command := 'SET statement_timeout = ''10min''; SELECT public.sp12_refresh_mfg_cost_mvs();'
    );
  END IF;
END $$;
