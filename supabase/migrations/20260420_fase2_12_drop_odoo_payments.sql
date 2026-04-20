-- Fase 2 Limpieza — final step: DROP TABLE public.odoo_payments.
-- Legacy proxy (53,684 rows derived from account.move residual).
-- Replaced by odoo_account_payments (real account.payment records).
-- Frontend migrated in commit f202c39. Addon _push_payments removed
-- in commit 0caf6d4 (qb19) — deploy confirmed by user on 2026-04-20.
-- odoo_sync_freshness view updated in commit accdbbf.

BEGIN;
  DROP TABLE IF EXISTS public.odoo_payments;

  INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed)
  VALUES (
    'drop_table',
    'odoo_payments',
    'Fase 2 — legacy proxy (53,684 rows) reemplazada por odoo_account_payments; frontend + addon migrados y deployados',
    'DROP TABLE IF EXISTS public.odoo_payments'
  );
COMMIT;
