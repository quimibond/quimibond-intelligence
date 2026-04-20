BEGIN;
  DROP VIEW IF EXISTS public.analytics_revenue_fiscal_monthly;
  DROP VIEW IF EXISTS public.analytics_revenue_operational_monthly;

  INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed) VALUES
    ('drop_view', 'analytics_revenue_fiscal_monthly',      'Fase 2.5 — thin wrapper sin callers frontend', 'DROP VIEW IF EXISTS public.analytics_revenue_fiscal_monthly'),
    ('drop_view', 'analytics_revenue_operational_monthly', 'Fase 2.5 — thin wrapper sin callers frontend', 'DROP VIEW IF EXISTS public.analytics_revenue_operational_monthly');
COMMIT;
