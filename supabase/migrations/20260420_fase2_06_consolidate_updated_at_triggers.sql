-- 20260420_fase2_06_consolidate_updated_at_triggers.sql
-- Fase 2 Limpieza: drop duplicate updated_at triggers.
-- `trg_touch_updated_at` runs an identical fn to `trg_set_updated_at`
-- (both do NEW.updated_at := now()). Keep the `set_updated_at` version,
-- drop the touch_* duplicates. Drop the fn only if orphaned afterwards.

BEGIN;
  DROP TRIGGER IF EXISTS trg_touch_updated_at ON public.odoo_products;
  DROP TRIGGER IF EXISTS trg_touch_updated_at ON public.odoo_bank_balances;
  DROP TRIGGER IF EXISTS trg_touch_updated_at ON public.odoo_users;

  DO $$
  DECLARE v_uses int;
  BEGIN
    SELECT count(*) INTO v_uses
      FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgfoid = 'public.touch_updated_at()'::regprocedure;
    IF v_uses = 0 THEN
      DROP FUNCTION public.touch_updated_at();
    END IF;
  END $$;

  INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed)
  VALUES ('drop_trigger', 'odoo_products/odoo_bank_balances/odoo_users',
          'Fase 2 — trg_touch_updated_at (3x) redundante con trg_set_updated_at',
          'DROP TRIGGER IF EXISTS trg_touch_updated_at ON public.odoo_products; DROP TRIGGER IF EXISTS trg_touch_updated_at ON public.odoo_bank_balances; DROP TRIGGER IF EXISTS trg_touch_updated_at ON public.odoo_users; DROP FUNCTION public.touch_updated_at();');
COMMIT;
