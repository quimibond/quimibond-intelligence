-- Fase 2 Limpieza: consolidate company-resolve triggers on odoo_order_lines.
-- Two triggers existed; keep trg_resolve_order_line_company (fn
-- auto_resolve_odoo_company — shared with odoo_invoice_lines, has
-- contacts fallback + EXCEPTION handler). Drop trg_resolve_order_company
-- (weaker fn, no fallback, no exception handler) and its fn if orphaned.

BEGIN;
  DROP TRIGGER IF EXISTS trg_resolve_order_company ON public.odoo_order_lines;

  DO $$
  DECLARE v_uses int;
  BEGIN
    SELECT count(*) INTO v_uses
      FROM pg_trigger WHERE NOT tgisinternal
        AND tgfoid='public.auto_resolve_order_line_company()'::regprocedure;
    IF v_uses = 0 THEN
      DROP FUNCTION public.auto_resolve_order_line_company();
    END IF;
  END $$;

  INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed)
  VALUES (
    'drop_trigger',
    'odoo_order_lines',
    'Fase 2 — drop trg_resolve_order_company (redundante, fn más débil); fn auto_resolve_order_line_company dropped si orphaned. Queda trg_resolve_order_line_company (fn auto_resolve_odoo_company, compartido con odoo_invoice_lines)',
    'DROP TRIGGER trg_resolve_order_company ON odoo_order_lines; conditional DROP FUNCTION auto_resolve_order_line_company'
  );
COMMIT;
