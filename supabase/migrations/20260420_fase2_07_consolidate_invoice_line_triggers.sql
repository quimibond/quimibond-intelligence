-- Fase 2 Limpieza: consolidate company-resolve triggers on odoo_invoice_lines.
-- Three triggers did the same work; keep trg_resolve_invoice_line_company
-- (fn auto_resolve_odoo_company — clearest name, INS+UPD, contacts fallback,
-- exception handler). Drop the 2 redundant ones + their fns if orphaned.
--
-- NOTE: auto_link_order_to_company is NOT dropped — it is also used on
-- odoo_sale_orders, odoo_purchase_orders, odoo_account_payments.
-- auto_link_invoice_line_company is orphaned and WILL be dropped.

BEGIN;
  DROP TRIGGER IF EXISTS trg_auto_link_invoice_line_company ON public.odoo_invoice_lines;
  DROP TRIGGER IF EXISTS trg_link_invoice_line_company ON public.odoo_invoice_lines;

  DO $$
  DECLARE v_auto_link_order_uses int; v_auto_link_invoice_uses int;
  BEGIN
    SELECT count(*) INTO v_auto_link_order_uses
      FROM pg_trigger WHERE NOT tgisinternal
        AND tgfoid='public.auto_link_order_to_company()'::regprocedure;
    IF v_auto_link_order_uses = 0 THEN
      DROP FUNCTION public.auto_link_order_to_company();
    END IF;

    SELECT count(*) INTO v_auto_link_invoice_uses
      FROM pg_trigger WHERE NOT tgisinternal
        AND tgfoid='public.auto_link_invoice_line_company()'::regprocedure;
    IF v_auto_link_invoice_uses = 0 THEN
      DROP FUNCTION public.auto_link_invoice_line_company();
    END IF;
  END $$;

  INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed)
  VALUES (
    'drop_trigger',
    'odoo_invoice_lines',
    'Fase 2 — drop trg_auto_link_invoice_line_company + trg_link_invoice_line_company (redundantes con trg_resolve_invoice_line_company); fn auto_link_invoice_line_company dropped (orphaned); auto_link_order_to_company kept (used on sale/purchase/account_payments)',
    'DROP TRIGGER trg_auto_link_invoice_line_company, trg_link_invoice_line_company ON odoo_invoice_lines; conditional DROP FUNCTION'
  );
COMMIT;
