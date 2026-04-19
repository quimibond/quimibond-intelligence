-- S1.2 v2 · Fix code review issues: drop colliding alias, qualify schema,
-- add GRANT, annotate existing analytics_ar_aging with sunset.
--
-- Issue 1 fixed: analytics_cash_flow_aging collided with existing canonical
--   analytics_ar_aging (finance AR semantic). Drop the collision.
-- Issue 2 fixed: qualify all objects as public.<name>.
-- Issue 3 fixed: add GRANT SELECT for service_role + authenticated.

-- ════ 1. Drop colliding alias (may have landed from v1) ════
DROP VIEW IF EXISTS public.analytics_cash_flow_aging;

-- ════ 2. analytics_budget_vs_actual (idempotent re-create with schema qual) ════
CREATE OR REPLACE VIEW public.analytics_budget_vs_actual AS
  SELECT * FROM public.budget_vs_actual;

COMMENT ON VIEW public.analytics_budget_vs_actual IS
  'L4 · Presupuesto vs real por cuenta contable y periodo (desviacion, desviacion_pct, status). Source: budget_vs_actual (legacy view, sunset 2026-06-01).';

GRANT SELECT ON public.analytics_budget_vs_actual TO service_role, authenticated;

-- ════ 3. Annotate existing analytics_ar_aging with sunset info ════
COMMENT ON VIEW public.analytics_ar_aging IS
  'L4 · Aging de cartera por empresa (current / 1-30 / 31-60 / 61-90 / 91-120 / 120+). Source: cash_flow_aging (legacy view, sunset 2026-06-01).';
