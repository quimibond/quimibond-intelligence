-- Sprint 9 — Limpiar periods inválidos en odoo_account_balances + CHECK constraint
--
-- Audit 2026-04-14: 3 filas con period='2202-02' (typo de Odoo, debería ser
-- '2022-02') sin account_code, sin account_name, balance neto agregado = 0.
-- Son inserts erróneos sin contexto.
--
-- Frontend (dashboard.ts:118, finance.ts:201) los filtra manualmente con
-- regex, pero es un band-aid. Esta migración los borra y agrega CHECK
-- constraint para prevenir reincidencia.

-- 1. Borrar los registros con periods inválidos
DELETE FROM odoo_account_balances
WHERE period !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$';

-- 2. CHECK constraint para prevenir nuevos periods malos
ALTER TABLE odoo_account_balances
  DROP CONSTRAINT IF EXISTS odoo_account_balances_period_format;
ALTER TABLE odoo_account_balances
  ADD CONSTRAINT odoo_account_balances_period_format
  CHECK (period ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$');

COMMENT ON CONSTRAINT odoo_account_balances_period_format
  ON odoo_account_balances IS
'Sprint 9: enforces YYYY-MM format with year 2000-2099. Catches Odoo
write_date typos like 2202-02 that previously polluted pl_estado_resultados.';
