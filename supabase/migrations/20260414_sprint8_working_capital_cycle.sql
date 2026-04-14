-- Sprint 8 — working_capital_cycle view
--
-- Audit 2026-04-14: cuando se computan DSO/DPO/DIO/CCC con
-- in_invoices.amount_total_mxn como proxy de COGS, los números salen
-- inflados porque in_invoices incluye OPEX + CAPEX + servicios + asientos
-- contables. Resultado: DIO=89d, CCC=80.7d (sobreestimados).
--
-- Esta view usa la fuente correcta:
-- - Revenue 12m: SUM(odoo_invoices) WHERE move_type='out_invoice'
-- - COGS 12m: SUM(odoo_account_balances) WHERE account_type='expense_direct_cost'
--             (la misma fuente que pl_estado_resultados — el plan de cuentas)
-- - AR: amount_residual_mxn de out_invoices not_paid/partial
-- - AP: amount_residual_mxn de in_invoices not_paid/partial
-- - Inventory: SUM(stock_qty * standard_price) FILTER active products
--
-- Métricas computadas (días):
-- - DSO = AR / (Revenue / 365)
-- - DPO = AP / (COGS / 365)
-- - DIO = Inventory / (COGS / 365)
-- - CCC = DSO + DIO - DPO
--
-- Resultados con datos reales (2026-04-14):
--   revenue_12m=198.7M cogs_12m=136.0M (GM 31.6%, vs 8.8% del proxy)
--   ar=26.1M ap=27.9M inventory=44.2M
--   DSO=47.9 DPO=74.9 DIO=118.6 CCC=91.6
--   working_capital=42.4M

CREATE OR REPLACE VIEW public.working_capital_cycle AS
WITH revenue_12m AS (
  SELECT SUM(amount_total_mxn) AS revenue
  FROM odoo_invoices
  WHERE move_type='out_invoice' AND state='posted'
    AND invoice_date >= CURRENT_DATE - INTERVAL '365 days'
), cogs_12m AS (
  -- Sólo cuentas marcadas como Costo Directo en el chart of accounts
  SELECT ABS(SUM(ab.balance)) AS cogs
  FROM odoo_account_balances ab
  JOIN odoo_chart_of_accounts coa ON coa.odoo_account_id = ab.odoo_account_id
  WHERE coa.account_type = 'expense_direct_cost'
    AND ab.period ~ '^20[12][0-9]-[01][0-9]$'
    AND ab.period >= TO_CHAR(CURRENT_DATE - INTERVAL '12 months', 'YYYY-MM')
), ar AS (
  SELECT SUM(COALESCE(amount_residual_mxn, amount_residual)) AS ar
  FROM odoo_invoices
  WHERE move_type='out_invoice' AND state='posted'
    AND payment_state IN ('not_paid','partial')
    AND amount_residual > 0
), ap AS (
  SELECT SUM(COALESCE(amount_residual_mxn, amount_residual)) AS ap
  FROM odoo_invoices
  WHERE move_type='in_invoice' AND state='posted'
    AND payment_state IN ('not_paid','partial')
    AND amount_residual > 0
), inventory AS (
  SELECT SUM(stock_qty * standard_price) AS inventory_value
  FROM odoo_products
  WHERE active = true AND stock_qty > 0 AND standard_price > 0
)
SELECT
  ROUND(r.revenue::numeric, 0)              AS revenue_12m_mxn,
  ROUND(c.cogs::numeric, 0)                 AS cogs_12m_mxn,
  ROUND((r.revenue - c.cogs)::numeric, 0)   AS gross_profit_12m_mxn,
  ROUND(((r.revenue - c.cogs) / NULLIF(r.revenue, 0) * 100)::numeric, 1)
                                            AS gross_margin_pct,
  ROUND(ar.ar::numeric, 0)                  AS ar_mxn,
  ROUND(ap.ap::numeric, 0)                  AS ap_mxn,
  ROUND(i.inventory_value::numeric, 0)      AS inventory_mxn,
  -- DSO: días promedio que tardamos en cobrar
  ROUND((ar.ar / NULLIF(r.revenue / 365, 0))::numeric, 1) AS dso_days,
  -- DPO: días promedio que tardamos en pagar
  ROUND((ap.ap / NULLIF(c.cogs / 365, 0))::numeric, 1)    AS dpo_days,
  -- DIO: días de inventario que mantenemos
  ROUND((i.inventory_value / NULLIF(c.cogs / 365, 0))::numeric, 1) AS dio_days,
  -- CCC: ciclo de conversión de efectivo
  ROUND((
    (ar.ar / NULLIF(r.revenue / 365, 0)) +
    (i.inventory_value / NULLIF(c.cogs / 365, 0)) -
    (ap.ap / NULLIF(c.cogs / 365, 0))
  )::numeric, 1) AS ccc_days,
  -- Capital de trabajo neto operativo
  ROUND((ar.ar + i.inventory_value - ap.ap)::numeric, 0) AS working_capital_mxn,
  NOW() AS computed_at
FROM revenue_12m r, cogs_12m c, ar, ap, inventory i;

COMMENT ON VIEW public.working_capital_cycle IS
'DSO/DPO/DIO/CCC computados con fuentes CORRECTAS: COGS desde odoo_account_balances (cuentas expense_direct_cost) en vez del proxy in_invoices.amount_total_mxn que infla con OPEX+CAPEX. Sprint 8 / audit 2026-04-14.';
