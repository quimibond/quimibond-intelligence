-- supabase/migrations/20260428_fix_refresh_and_reconciliation_timeouts.sql
--
-- Audit follow-up (2026-04-28): close residual cron timeout failures.
--
-- AFFECTED CRONS (post-fix windows from cron.job_run_details since 2026-04-24)
--   silver_sp4_reconcile_daily             40% OK (3 fails, 2 ok)
--   silver_sp2_refresh_canonical_nightly   60% OK (2 fails, 3 ok)
--   refresh-all-matviews                   93% OK (4 fails, 57 ok)
--
-- ROOT CAUSE
-- Default statement_timeout = 2min. refresh_all_matviews() refreshes ~30 MVs
-- including canonical_order_lines (21 MB) — CONCURRENTLY refresh of that
-- single MV exceeds 2min by itself on cold runs. Similar story with
-- payment_predictions and mv_mo_actual_material_cost.
-- run_reconciliation() orchestrates 5 _sp*_run_extra subfunctions; total
-- work also exceeds 2min when invoked with p_key=NULL (full sweep used by
-- silver_sp4_reconcile_daily and silver_sp2_refresh_canonical_nightly).
--
-- FIX
-- Pattern matches SP9 T5.3 (compute_priority_scores) which uses
-- `SET LOCAL statement_timeout='10min'`. Here we use ALTER FUNCTION ... SET
-- to avoid re-emitting the function bodies (run_reconciliation orchestrates
-- 600+ LOC across subfunctions; refresh_all_matviews has retry logic).
--
-- ALTER FUNCTION ... SET applies a per-call SET LOCAL on entry that
-- propagates into subqueries (including the EXECUTE ... REFRESH MATERIALIZED
-- VIEW calls inside refresh_all_matviews and the _sp*_run_extra calls inside
-- run_reconciliation) and reverts on function exit.

ALTER FUNCTION public.refresh_all_matviews()
  SET statement_timeout = '10min';

ALTER FUNCTION public.run_reconciliation(text)
  SET statement_timeout = '10min';
