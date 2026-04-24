-- F-WTM: "¿Dónde está el dinero?" — cash reconciliation RPC.
--
-- Responde la pregunta clásica: "el P&L dice que gané X, pero no tengo
-- cash, ¿dónde se fue?". Compara saldos acumulados del balance sheet
-- entre dos cortes y clasifica cada movimiento como fuente (entrada de
-- cash) o uso (salida).
--
-- Lógica:
--   Δ cash = net_income
--          − ΔAR (si AR sube, cash no entró)
--          − ΔInventario
--          − ΔPagos anticipados
--          − ΔActivo fijo (CAPEX)
--          + ΔAP (si AP sube, no pagaste)
--          + ΔOtros pasivos
--          + ΔDeuda
--          + (Δequity − net_income)  ← retiros/aportaciones
--
-- Saldos acumulados: sum(balance) hasta un corte de mes YYYY-MM.
--
-- Signo display: assets positivos (storage ya es debit-normal), liab y
-- equity se niegan para que balance positivo = pasivo/capital positivo.

CREATE OR REPLACE FUNCTION public.get_cash_reconciliation(
  p_from_period text,
  p_to_period text
)
RETURNS TABLE(
  category text,
  category_label text,
  prefix_pattern text,
  opening_mxn numeric,
  closing_mxn numeric,
  delta_mxn numeric,
  cash_flow_direction text
)
LANGUAGE sql STABLE
AS $fn$
WITH categories AS (
  SELECT * FROM (VALUES
    ('cash',          'Efectivo y bancos',         'asset_cash',            'source'),
    ('ar',            'Cartera de clientes (AR)',   'asset_receivable',      'use'),
    ('inventory',     'Inventarios',                'asset_current',         'use'),
    ('prepayments',   'Pagos anticipados',          'asset_prepayments',     'use'),
    ('fixed',         'Activos fijos (maquinaria)', 'asset_fixed',           'use'),
    ('ap',            'Proveedores (AP)',           'liability_payable',     'source'),
    ('credit_card',   'Tarjetas de crédito',        'liability_credit_card', 'source'),
    ('current_liab',  'Otros pasivos corrientes',   'liability_current',     'source'),
    ('debt_lp',       'Deuda largo plazo',          'liability_non_current', 'source'),
    ('equity',        'Capital contable',           'equity_unaffected',     'source')
  ) AS t(category, category_label, type_pattern, cash_flow_direction)
),
balances AS (
  SELECT
    cab.account_type,
    cab.period,
    SUM(cab.balance) AS period_balance
  FROM public.canonical_account_balances cab
  WHERE cab.deprecated = false
    AND cab.period <= p_to_period
  GROUP BY cab.account_type, cab.period
),
opening AS (
  SELECT account_type, SUM(period_balance) AS bal
  FROM balances WHERE period <= p_from_period
  GROUP BY account_type
),
closing AS (
  SELECT account_type, SUM(period_balance) AS bal
  FROM balances WHERE period <= p_to_period
  GROUP BY account_type
)
SELECT
  c.category,
  c.category_label,
  c.type_pattern AS prefix_pattern,
  CASE
    WHEN c.type_pattern LIKE 'asset_%' THEN COALESCE(o.bal, 0)
    ELSE -COALESCE(o.bal, 0)
  END AS opening_mxn,
  CASE
    WHEN c.type_pattern LIKE 'asset_%' THEN COALESCE(cl.bal, 0)
    ELSE -COALESCE(cl.bal, 0)
  END AS closing_mxn,
  CASE
    WHEN c.type_pattern LIKE 'asset_%' THEN (COALESCE(cl.bal, 0) - COALESCE(o.bal, 0))
    ELSE -(COALESCE(cl.bal, 0) - COALESCE(o.bal, 0))
  END AS delta_mxn,
  c.cash_flow_direction
FROM categories c
LEFT JOIN opening o ON o.account_type = c.type_pattern
LEFT JOIN closing cl ON cl.account_type = c.type_pattern
ORDER BY
  CASE c.type_pattern
    WHEN 'asset_cash' THEN 1
    WHEN 'asset_receivable' THEN 2
    WHEN 'asset_current' THEN 3
    WHEN 'asset_prepayments' THEN 4
    WHEN 'asset_fixed' THEN 5
    WHEN 'liability_payable' THEN 6
    WHEN 'liability_credit_card' THEN 7
    WHEN 'liability_current' THEN 8
    WHEN 'liability_non_current' THEN 9
    WHEN 'equity_unaffected' THEN 10
  END;
$fn$;
