-- supabase/migrations/20260429_fix_sp12_refresh_mfg_cost_timeout.sql
--
-- Audit follow-up (2026-04-29): close residual cron timeout on
-- sp12_refresh_mfg_cost_mvs_hourly.
--
-- AFFECTED CRON (since 2026-04-23 18:00 UTC start)
--   sp12_refresh_mfg_cost_mvs_hourly   97% OK (4 fails / 142 ok)
--   - succeeded: avg 29s, max 111s
--   - failed:    122s exact = default statement_timeout=2min hit
--   - failures:  2026-04-25 08:00, 2026-04-29 06:00 (most recent), +2 more
--
-- ROOT CAUSE
-- The cron command was inline SQL: two REFRESH MATERIALIZED VIEW calls
-- (mv_bom_standard_cost + mv_mo_actual_material_cost). Inline cron commands
-- inherit the role's default statement_timeout (2min). On occasional cold/
-- contention runs the second MV refresh tips past 2min and the whole job
-- gets cancelled.
--
-- FIX (matches the 2026-04-28 pattern from
-- 20260428_fix_refresh_and_reconciliation_timeouts.sql)
-- Wrap the two REFRESHes in a SECURITY-aware function with
-- `SET statement_timeout='10min'`, then reapply the cron to call it. This
-- mirrors how refresh_all_matviews / run_reconciliation already handle the
-- same problem (per-call SET LOCAL via ALTER FUNCTION ... SET).
--
-- NOTE
-- We use cron.alter_job by jobname rather than hard-coded jobid (16 today)
-- so the migration is idempotent across environments.

CREATE OR REPLACE FUNCTION public.sp12_refresh_mfg_cost_mvs()
RETURNS void
LANGUAGE plpgsql
SET statement_timeout = '10min'
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW public.mv_bom_standard_cost;
  REFRESH MATERIALIZED VIEW public.mv_mo_actual_material_cost;
END;
$$;

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid
  FROM cron.job
  WHERE jobname = 'sp12_refresh_mfg_cost_mvs_hourly';

  IF v_jobid IS NULL THEN
    RAISE NOTICE 'sp12_refresh_mfg_cost_mvs_hourly cron not found, skipping alter_job';
  ELSE
    PERFORM cron.alter_job(
      job_id  := v_jobid,
      command := 'SELECT public.sp12_refresh_mfg_cost_mvs();'
    );
  END IF;
END $$;
