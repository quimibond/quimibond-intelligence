-- Fase 2 Limpieza: drop employee_metrics table + calculate_employee_metrics fn + get_employee_dashboard fn.
-- 34 rows DEPRECATED; writer in /api/pipeline/employee-metrics retired here.
-- get_employee_dashboard() was entirely dependent on employee_metrics (SELECT * FROM employee_metrics).
-- No views, MVs, or frontend callers depend on these objects.

BEGIN;
  DROP FUNCTION IF EXISTS public.get_employee_dashboard(text);
  DROP FUNCTION IF EXISTS public.calculate_employee_metrics();
  DROP TABLE IF EXISTS public.employee_metrics;

  INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed) VALUES
    ('drop_function', 'employee_metrics', 'Fase 2 — get_employee_dashboard() dependia de employee_metrics, retirada', 'DROP FUNCTION IF EXISTS public.get_employee_dashboard(text)'),
    ('drop_function', 'employee_metrics', 'Fase 2 — calculate_employee_metrics() sin tabla destino', 'DROP FUNCTION IF EXISTS public.calculate_employee_metrics()'),
    ('drop_table', 'employee_metrics', 'Fase 2 — 34 rows DEPRECATED; writer retirado', 'DROP TABLE IF EXISTS public.employee_metrics');
COMMIT;
