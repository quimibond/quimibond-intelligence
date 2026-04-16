-- ═══════════════════════════════════════════════════════════════
-- H5 — account_payment_profile: repoblar account_code
-- ═══════════════════════════════════════════════════════════════
-- Audit finding (DATA_AUDIT_REPORT.md §H5):
-- 342/342 filas con `account_code = ''` vacío. Join con
-- `odoo_chart_of_accounts.code` aparentemente roto.
--
-- Root cause (investigado post-audit): la view sí joina por
-- `odoo_account_id`, el problema real estaba upstream en qb19 —
-- `_push_chart_of_accounts` no resolvía `account.code` per-company
-- en Odoo 17+ (requiere `code_store_ids`). Fix ya aplicado en
-- commit qb19 `35a3ea7 fix(sync): resolve account.code per-company
-- via code_store_ids (Odoo 17+)`.
--
-- Esta migración:
--   1. Verifica que odoo_chart_of_accounts.code ya tiene valores.
--   2. Fuerza REFRESH MATERIALIZED VIEW account_payment_profile.
--   3. Raise notice con el % de filas con code no vacío.
--
-- No recrea la MV — la def de 20260416_cashflow_profiles_v3_fix_
-- classification.sql es correcta, solo necesita datos frescos.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  total_accounts int;
  with_code      int;
  pct            numeric;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE code <> '' AND code IS NOT NULL)
    INTO total_accounts, with_code
  FROM odoo_chart_of_accounts;

  pct := CASE WHEN total_accounts > 0
              THEN ROUND(100.0 * with_code / total_accounts, 1)
              ELSE 0 END;

  RAISE NOTICE 'odoo_chart_of_accounts: % de % filas tienen code no-vacío (% %%)',
    with_code, total_accounts, pct;

  IF pct < 50 THEN
    RAISE WARNING 'odoo_chart_of_accounts.code populado en menos del 50%%. '
                  'Verifica que qb19 commit 35a3ea7 está deployado en Odoo.sh '
                  'y que el último sync horario corrió. No refrescaré la MV '
                  'porque va a salir igual de vacía.';
  ELSE
    RAISE NOTICE 'Refrescando account_payment_profile...';
    REFRESH MATERIALIZED VIEW CONCURRENTLY account_payment_profile;
    RAISE NOTICE 'Refresh OK. Verifica: SELECT COUNT(*) FILTER (WHERE account_code <> '''') FROM account_payment_profile;';
  END IF;
END $$;

COMMIT;
