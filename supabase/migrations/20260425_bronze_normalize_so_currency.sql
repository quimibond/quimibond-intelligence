-- 2026-04-25 · Bronze normalization: odoo_sale_orders.currency = '001' → 'MXN'
--
-- Background: PV13053 (odoo_order_id=13107) was set in Odoo with currency='001',
-- a sentinel that Odoo treats as "unset" but no canonical layer recognises.
-- Sweep 3 (2026-04-24) patched the Bronze row to 'MXN' but the qb19 hourly
-- sync overwrote it back to '001' because the bug lives in Odoo upstream.
--
-- Fix: BEFORE INSERT/UPDATE OF currency triggers on both odoo_sale_orders and
-- odoo_order_lines map ('001' | NULL | '') → 'MXN' transparently. Self-heals
-- on every sync without requiring an Odoo-side fix.
--
-- Documented in docs/DATA_INTEGRITY.md (2026-04-25 entry).
-- Already applied to production via execute_safe_ddl on 2026-04-25.

CREATE OR REPLACE FUNCTION public.trg_normalize_odoo_so_currency()
RETURNS trigger LANGUAGE plpgsql AS $func$
BEGIN
  IF NEW.currency = '001' OR NEW.currency IS NULL OR NEW.currency = '' THEN
    NEW.currency := 'MXN';
  END IF;
  RETURN NEW;
END;
$func$;

CREATE OR REPLACE FUNCTION public.trg_normalize_odoo_order_lines_currency()
RETURNS trigger LANGUAGE plpgsql AS $func$
BEGIN
  IF NEW.currency = '001' OR NEW.currency IS NULL OR NEW.currency = '' THEN
    NEW.currency := 'MXN';
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS odoo_sale_orders_normalize_currency_trg
  ON public.odoo_sale_orders;
CREATE TRIGGER odoo_sale_orders_normalize_currency_trg
  BEFORE INSERT OR UPDATE OF currency
  ON public.odoo_sale_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_normalize_odoo_so_currency();

DROP TRIGGER IF EXISTS odoo_order_lines_normalize_currency_trg
  ON public.odoo_order_lines;
CREATE TRIGGER odoo_order_lines_normalize_currency_trg
  BEFORE INSERT OR UPDATE OF currency
  ON public.odoo_order_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_normalize_odoo_order_lines_currency();
