-- Fase 2.5.1: drop 4 analytics_finance_* thin wrappers.
-- Frontend callsites migrated to base views in previous commit.
-- Fase 2.5 Option A previously dropped 2 unused wrappers (revenue_fiscal_monthly, revenue_operational_monthly).
-- This completes the analytics_* wrapper cleanup.

BEGIN;
  DROP VIEW IF EXISTS public.analytics_finance_cash_position;
  DROP VIEW IF EXISTS public.analytics_finance_cfo_snapshot;
  DROP VIEW IF EXISTS public.analytics_finance_income_statement;
  DROP VIEW IF EXISTS public.analytics_finance_working_capital;

  INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed) VALUES
    ('drop_view','analytics_finance_cash_position',   'Fase 2.5.1 — thin wrapper, frontend migrado a cash_position',       'DROP VIEW IF EXISTS public.analytics_finance_cash_position'),
    ('drop_view','analytics_finance_cfo_snapshot',    'Fase 2.5.1 — thin wrapper, frontend migrado a cfo_dashboard',       'DROP VIEW IF EXISTS public.analytics_finance_cfo_snapshot'),
    ('drop_view','analytics_finance_income_statement','Fase 2.5.1 — thin wrapper, frontend migrado a pl_estado_resultados','DROP VIEW IF EXISTS public.analytics_finance_income_statement'),
    ('drop_view','analytics_finance_working_capital', 'Fase 2.5.1 — thin wrapper, frontend migrado a working_capital',     'DROP VIEW IF EXISTS public.analytics_finance_working_capital');
COMMIT;
