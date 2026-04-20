-- Fase 2 Limpieza: drop budgets + budget_vs_actual + analytics_budget_vs_actual (Option A-extended).
-- budgets had 0 rows since creation; the two dependent views always returned
-- empty — frontend agent contexts querying analytics_budget_vs_actual had
-- dead code. User decision 2026-04-20: drop everything, no empty contract.

BEGIN;
  DROP VIEW IF EXISTS public.analytics_budget_vs_actual;
  DROP VIEW IF EXISTS public.budget_vs_actual;
  DROP TABLE IF EXISTS public.budgets;

  INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed) VALUES
    ('drop_view',  'analytics_budget_vs_actual', 'Fase 2 — alias de budget_vs_actual, consumido por 2 agent contexts pero siempre vacío', 'DROP VIEW IF EXISTS public.analytics_budget_vs_actual'),
    ('drop_view',  'budget_vs_actual',           'Fase 2 — dependía de budgets (0 rows)', 'DROP VIEW IF EXISTS public.budget_vs_actual'),
    ('drop_table', 'budgets',                    'Fase 2 — 0 rows, feature nunca implementada; decisión user = drop', 'DROP TABLE IF EXISTS public.budgets');
COMMIT;
