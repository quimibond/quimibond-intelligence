-- ============================================================================
-- Migration 20260416: Captura estado actual de cfo_dashboard y cash_position
--
-- Audit 2026-04-16: Las vistas `cfo_dashboard` y `cash_position` viven en
-- Supabase con un schema más reciente que lo que define migration 034:
--
--   migration 034 originalmente:
--     cfo_dashboard: efectivo_total, cuentas_por_cobrar, cuentas_por_pagar,
--                    cartera_vencida, ventas_30d, cobros_30d, pagos_prov_30d,
--                    clientes_morosos
--     cash_position: banco, tipo, moneda, cuenta, saldo, actualizado
--
--   estado real en producción:
--     cfo_dashboard:  efectivo_mxn, efectivo_usd, efectivo_total_mxn,
--                     deuda_tarjetas, posicion_neta, cuentas_por_cobrar,
--                     cuentas_por_pagar, cartera_vencida, ventas_30d,
--                     cobros_30d, pagos_prov_30d, clientes_morosos
--     cash_position:  + saldo_mxn  (MXN convertido, ahora usado por frontend)
--
-- El frontend (src/lib/queries/finance.ts + src/app/finanzas/page.tsx) lee
-- los nombres nuevos con fallback `Number(x) || 0`. Si se aplican las
-- migraciones desde cero en un entorno nuevo se rompe silenciosamente.
--
-- Esta migración captura el estado real del DB para que el schema esté
-- reproducible y para cerrar el drift.
--
-- Formulas validadas contra datos reales (2026-04-16 19:00 UTC):
--   efectivo_mxn          = 1,049,991  (SUM current_balance_mxn WHERE currency='MXN' AND current_balance > 0)
--   efectivo_usd          = 179,031    (SUM current_balance      WHERE currency='USD' AND current_balance > 0)
--   efectivo_total_mxn    = 4,218,436  (SUM current_balance_mxn  WHERE current_balance_mxn > 0)
--   deuda_tarjetas        = 55,809     (ABS(SUM current_balance_mxn) WHERE current_balance_mxn < 0)
--   posicion_neta         = 4,162,627  (= efectivo_total_mxn − deuda_tarjetas)
--
-- También re-crea cash_position con saldo_mxn (que ya depende del sync
-- push de qb19 sobre odoo_bank_balances.current_balance_mxn).
-- ============================================================================

DROP VIEW IF EXISTS cfo_dashboard CASCADE;
DROP VIEW IF EXISTS cash_position CASCADE;


-- ═══════════════════════════════════════════════════════════════
-- VIEW: cash_position
-- Incluye saldo_mxn (MXN canónico) para aggregations frontend.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW cash_position AS
SELECT
  name                 AS banco,
  journal_type         AS tipo,        -- 'bank' | 'cash' | 'credit' (qb19 >= Abr-2026)
  currency             AS moneda,
  bank_account         AS cuenta,
  current_balance      AS saldo,       -- nativo de la moneda del journal
  current_balance_mxn  AS saldo_mxn,   -- convertido a MXN (company currency)
  updated_at           AS actualizado
FROM odoo_bank_balances
ORDER BY current_balance_mxn DESC NULLS LAST;

COMMENT ON VIEW cash_position IS
  'Saldos bancarios en moneda nativa + MXN canónico. saldo_mxn es la fuente para aggregations de efectivo. Usado por /finanzas Posición de caja.';


-- ═══════════════════════════════════════════════════════════════
-- VIEW: cfo_dashboard
-- Snapshot ejecutivo del CFO. Una sola fila.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW cfo_dashboard AS
WITH
  cash AS (
    SELECT
      COALESCE(SUM(current_balance_mxn) FILTER (WHERE currency = 'MXN' AND current_balance > 0), 0)::numeric AS efectivo_mxn,
      COALESCE(SUM(current_balance)     FILTER (WHERE currency = 'USD' AND current_balance > 0), 0)::numeric AS efectivo_usd,
      COALESCE(SUM(current_balance_mxn) FILTER (WHERE current_balance_mxn > 0), 0)::numeric                  AS efectivo_total_mxn,
      COALESCE(ABS(SUM(current_balance_mxn) FILTER (WHERE current_balance_mxn < 0)), 0)::numeric             AS deuda_tarjetas
    FROM odoo_bank_balances
  ),
  ar AS (
    SELECT
      COALESCE(SUM(amount_residual), 0)::numeric AS cuentas_por_cobrar,
      COALESCE(SUM(amount_residual) FILTER (WHERE days_overdue > 0), 0)::numeric AS cartera_vencida,
      COUNT(DISTINCT odoo_partner_id) FILTER (WHERE days_overdue > 0)::int AS clientes_morosos
    FROM odoo_invoices
    WHERE move_type = 'out_invoice'
      AND payment_state IN ('not_paid', 'partial')
      AND amount_residual > 0
  ),
  ap AS (
    SELECT COALESCE(SUM(amount_residual), 0)::numeric AS cuentas_por_pagar
    FROM odoo_invoices
    WHERE move_type = 'in_invoice'
      AND payment_state IN ('not_paid', 'partial')
      AND amount_residual > 0
  ),
  -- Ventas 30d: devengado (facturado) — vale con IVA porque es lo que se cobrará
  ventas AS (
    SELECT COALESCE(SUM(amount_total_mxn), 0)::numeric AS ventas_30d
    FROM odoo_invoices
    WHERE move_type = 'out_invoice'
      AND state = 'posted'
      AND invoice_date >= CURRENT_DATE - INTERVAL '30 days'
  ),
  -- Cobros/pagos reales 30d — usa amount_signed (MXN siempre, signed por dirección).
  -- Para outbound devuelve valor negativo; frontend puede usar Math.abs() para display.
  payments AS (
    SELECT
      COALESCE(SUM(amount_signed) FILTER (WHERE payment_type = 'inbound'),  0)::numeric AS cobros_30d,
      COALESCE(SUM(amount_signed) FILTER (WHERE payment_type = 'outbound'), 0)::numeric AS pagos_prov_30d
    FROM odoo_account_payments
    WHERE state = 'paid'
      AND date >= CURRENT_DATE - INTERVAL '30 days'
  )
SELECT
  ROUND(cash.efectivo_mxn, 0)                                    AS efectivo_mxn,
  ROUND(cash.efectivo_usd, 0)                                    AS efectivo_usd,
  ROUND(cash.efectivo_total_mxn, 0)                              AS efectivo_total_mxn,
  ROUND(cash.deuda_tarjetas, 0)                                  AS deuda_tarjetas,
  ROUND(cash.efectivo_total_mxn - cash.deuda_tarjetas, 0)        AS posicion_neta,
  ROUND(ar.cuentas_por_cobrar, 0)                                AS cuentas_por_cobrar,
  ROUND(ap.cuentas_por_pagar, 0)                                 AS cuentas_por_pagar,
  ROUND(ar.cartera_vencida, 0)                                   AS cartera_vencida,
  ROUND(ventas.ventas_30d, 0)                                    AS ventas_30d,
  ROUND(payments.cobros_30d, 0)                                  AS cobros_30d,
  ROUND(payments.pagos_prov_30d, 0)                              AS pagos_prov_30d,
  ar.clientes_morosos
FROM cash, ar, ap, ventas, payments;

COMMENT ON VIEW cfo_dashboard IS
  'Snapshot ejecutivo del CFO (una fila). Incluye efectivo MXN/USD, deuda tarjetas, posición neta, CxC, CxP, cartera vencida, ventas/cobros/pagos 30d, clientes morosos. Fuente canónica para /finanzas KPIs.';


GRANT SELECT ON cash_position   TO anon, authenticated, service_role;
GRANT SELECT ON cfo_dashboard   TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
