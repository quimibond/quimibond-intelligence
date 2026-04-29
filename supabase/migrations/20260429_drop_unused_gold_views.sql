-- supabase/migrations/20260429_drop_unused_gold_views.sql
--
-- Drop 3 unreferenced views (audit 2026-04-29).
--
-- All three were scaffolded as reports/helpers but never wired to UI:
--
--   v_mo_material_variance              SP12.2 helper view comparing actual
--                                       material cost vs standard BOM cost
--                                       per MO. Created during invariant
--                                       development but rendered redundant
--                                       once manufacturing.material_cost_variance
--                                       invariant moved to direct query.
--                                       0 frontend refs, 0 cron refs, 0
--                                       function refs (sp12 invariant doesn't
--                                       use it — queries source MV directly).
--
--   gold_state_mismatch_watchlist       Posted/cancelled state mismatch
--                                       watchlist. 0 frontend refs, 0
--                                       function refs, no comment.
--                                       reconciliation_issues already
--                                       captures the same condition via
--                                       invoice.state_mismatch_posted_cancelled
--                                       invariant.
--
--   gold_inventory_valuation_drift_monthly  SP11 Fase 2 monthly drift report
--                                       (115.* balance vs valued stock.moves).
--                                       Per its own comment "sin alertas
--                                       automáticas — invariant C queda
--                                       disabled". 0 consumers.
--
-- pg_stat_statements shows only 3-9 calls each, all from migrations,
-- one-off verifies, or audit queries. No recurring read pattern.

DROP VIEW IF EXISTS public.v_mo_material_variance;
DROP VIEW IF EXISTS public.gold_state_mismatch_watchlist;
DROP VIEW IF EXISTS public.gold_inventory_valuation_drift_monthly;
