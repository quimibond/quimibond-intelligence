-- ============================================================================
-- Migration 035: Working Capital, Cash Flow Alerts, Budget vs Actual
--
-- 1. working_capital view — consolidated liquidity position
-- 2. cashflow_runway function — days until cash runs out for payroll
-- 3. budgets table + budget_vs_actual view
-- 4. cfdi_invoice_match view — CFDI ↔ invoice cross-reference via UUID
-- ============================================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. VIEW: Working Capital (Capital de Trabajo)
--    efectivo + CxC - CxP - deuda_tarjetas
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW working_capital AS
SELECT
  -- Cash in banks (positive balances only = real cash)
  (SELECT COALESCE(round(sum(current_balance)::numeric, 0), 0)
   FROM odoo_bank_balances
   WHERE current_balance > 0) AS efectivo_disponible,

  -- Credit card / negative balances (debt)
  (SELECT COALESCE(round(abs(sum(current_balance))::numeric, 0), 0)
   FROM odoo_bank_balances
   WHERE current_balance < 0) AS deuda_tarjetas,

  -- Net cash position
  (SELECT COALESCE(round(sum(current_balance)::numeric, 0), 0)
   FROM odoo_bank_balances) AS efectivo_neto,

  -- Accounts receivable (pending customer invoices)
  (SELECT COALESCE(round(sum(amount_residual)::numeric, 0), 0)
   FROM odoo_invoices
   WHERE move_type = 'out_invoice'
     AND payment_state IN ('not_paid', 'partial')
     AND amount_residual > 0) AS cuentas_por_cobrar,

  -- Accounts payable (pending supplier invoices)
  (SELECT COALESCE(round(sum(amount_residual)::numeric, 0), 0)
   FROM odoo_invoices
   WHERE move_type = 'in_invoice'
     AND payment_state IN ('not_paid', 'partial')
     AND amount_residual > 0) AS cuentas_por_pagar,

  -- Working capital = cash + CxC - CxP
  (SELECT COALESCE(sum(current_balance), 0) FROM odoo_bank_balances)
  + (SELECT COALESCE(sum(amount_residual), 0) FROM odoo_invoices
     WHERE move_type = 'out_invoice' AND payment_state IN ('not_paid', 'partial') AND amount_residual > 0)
  - (SELECT COALESCE(sum(amount_residual), 0) FROM odoo_invoices
     WHERE move_type = 'in_invoice' AND payment_state IN ('not_paid', 'partial') AND amount_residual > 0)
  AS capital_de_trabajo,

  -- Current ratio = current assets / current liabilities
  CASE
    WHEN (SELECT COALESCE(sum(amount_residual), 0) FROM odoo_invoices
          WHERE move_type = 'in_invoice' AND payment_state IN ('not_paid', 'partial') AND amount_residual > 0) > 0
    THEN round((
      (SELECT COALESCE(sum(current_balance), 0) FROM odoo_bank_balances WHERE current_balance > 0)
      + (SELECT COALESCE(sum(amount_residual), 0) FROM odoo_invoices
         WHERE move_type = 'out_invoice' AND payment_state IN ('not_paid', 'partial') AND amount_residual > 0)
    )::numeric / (
      (SELECT COALESCE(abs(sum(current_balance)), 0) FROM odoo_bank_balances WHERE current_balance < 0)
      + (SELECT COALESCE(sum(amount_residual), 0) FROM odoo_invoices
         WHERE move_type = 'in_invoice' AND payment_state IN ('not_paid', 'partial') AND amount_residual > 0)
    )::numeric, 2)
    ELSE NULL
  END AS ratio_liquidez,

  -- Quick ratio = cash only / current liabilities
  CASE
    WHEN (SELECT COALESCE(sum(amount_residual), 0) FROM odoo_invoices
          WHERE move_type = 'in_invoice' AND payment_state IN ('not_paid', 'partial') AND amount_residual > 0) > 0
    THEN round(
      (SELECT COALESCE(sum(current_balance), 0) FROM odoo_bank_balances WHERE current_balance > 0)::numeric
      / (
        (SELECT COALESCE(abs(sum(current_balance)), 0) FROM odoo_bank_balances WHERE current_balance < 0)
        + (SELECT COALESCE(sum(amount_residual), 0) FROM odoo_invoices
           WHERE move_type = 'in_invoice' AND payment_state IN ('not_paid', 'partial') AND amount_residual > 0)
      )::numeric, 2)
    ELSE NULL
  END AS ratio_prueba_acida;


-- ═══════════════════════════════════════════════════════════════
-- 2. FUNCTION: cashflow_runway
--    Estimates days until cash runs out based on:
--    - Current bank balance
--    - Expected collections (CxC by due date buckets)
--    - Expected payments (CxP by due date buckets)
--    - Monthly payroll cost (estimated from CFDI nómina)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION cashflow_runway()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cash numeric;
  v_nomina_mensual numeric;
  v_cobros_7d numeric;
  v_cobros_15d numeric;
  v_cobros_30d numeric;
  v_pagos_7d numeric;
  v_pagos_15d numeric;
  v_pagos_30d numeric;
  v_saldo_7d numeric;
  v_saldo_15d numeric;
  v_saldo_30d numeric;
  v_dias_runway int;
  v_alerta text;
  v_severidad text;
BEGIN
  -- Current net cash (all bank journals)
  SELECT COALESCE(sum(current_balance), 0) INTO v_cash
  FROM odoo_bank_balances;

  -- Monthly payroll estimated from CFDI nómina (tipo N)
  -- Average last 3 months of nómina CFDIs
  SELECT COALESCE(round(avg(monthly_total)::numeric, 0), 0) INTO v_nomina_mensual
  FROM (
    SELECT date_trunc('month', fecha) AS mes, sum(total) AS monthly_total
    FROM cfdi_documents
    WHERE tipo_comprobante = 'N'
      AND fecha >= current_date - interval '90 days'
    GROUP BY date_trunc('month', fecha)
  ) monthly;

  -- If no nómina CFDIs, try to estimate from expense accounts (payroll-related)
  IF v_nomina_mensual = 0 THEN
    SELECT COALESCE(round(avg(balance)::numeric, 0), 0) INTO v_nomina_mensual
    FROM odoo_account_balances
    WHERE (account_name ILIKE '%sueldos%' OR account_name ILIKE '%salarios%'
           OR account_name ILIKE '%nomina%' OR account_name ILIKE '%nómina%')
      AND account_type LIKE 'expense%';
  END IF;

  -- Expected collections next 7/15/30 days (from customer invoices by due_date)
  SELECT COALESCE(sum(amount_residual), 0) INTO v_cobros_7d
  FROM odoo_invoices
  WHERE move_type = 'out_invoice'
    AND payment_state IN ('not_paid', 'partial')
    AND amount_residual > 0
    AND due_date <= current_date + interval '7 days';

  SELECT COALESCE(sum(amount_residual), 0) INTO v_cobros_15d
  FROM odoo_invoices
  WHERE move_type = 'out_invoice'
    AND payment_state IN ('not_paid', 'partial')
    AND amount_residual > 0
    AND due_date <= current_date + interval '15 days';

  SELECT COALESCE(sum(amount_residual), 0) INTO v_cobros_30d
  FROM odoo_invoices
  WHERE move_type = 'out_invoice'
    AND payment_state IN ('not_paid', 'partial')
    AND amount_residual > 0
    AND due_date <= current_date + interval '30 days';

  -- Expected payments next 7/15/30 days (supplier invoices by due_date)
  SELECT COALESCE(sum(amount_residual), 0) INTO v_pagos_7d
  FROM odoo_invoices
  WHERE move_type = 'in_invoice'
    AND payment_state IN ('not_paid', 'partial')
    AND amount_residual > 0
    AND due_date <= current_date + interval '7 days';

  SELECT COALESCE(sum(amount_residual), 0) INTO v_pagos_15d
  FROM odoo_invoices
  WHERE move_type = 'in_invoice'
    AND payment_state IN ('not_paid', 'partial')
    AND amount_residual > 0
    AND due_date <= current_date + interval '15 days';

  SELECT COALESCE(sum(amount_residual), 0) INTO v_pagos_30d
  FROM odoo_invoices
  WHERE move_type = 'in_invoice'
    AND payment_state IN ('not_paid', 'partial')
    AND amount_residual > 0
    AND due_date <= current_date + interval '30 days';

  -- Projected balances
  v_saldo_7d  := v_cash + v_cobros_7d  - v_pagos_7d;
  v_saldo_15d := v_cash + v_cobros_15d - v_pagos_15d - (v_nomina_mensual / 2); -- quincenal
  v_saldo_30d := v_cash + v_cobros_30d - v_pagos_30d - v_nomina_mensual;

  -- Calculate runway in days (simplified: daily burn = (payroll + avg daily payments) - avg daily collections)
  -- Use 30d data for daily rate
  DECLARE
    v_daily_burn numeric;
  BEGIN
    v_daily_burn := (v_nomina_mensual / 30.0) + (v_pagos_30d / 30.0) - (v_cobros_30d / 30.0);
    IF v_daily_burn > 0 THEN
      v_dias_runway := floor(v_cash / v_daily_burn);
    ELSE
      v_dias_runway := 999; -- net positive cash flow
    END IF;
  END;

  -- Alert logic
  IF v_saldo_15d < 0 THEN
    v_alerta := format('CRITICO: En 15 dias el saldo proyectado es -%s. No alcanza para nomina ($%s quincenal).',
      to_char(abs(v_saldo_15d), 'FM999,999,999'), to_char(v_nomina_mensual / 2, 'FM999,999,999'));
    v_severidad := 'critical';
  ELSIF v_saldo_15d < v_nomina_mensual / 2 THEN
    v_alerta := format('ALERTA: En 15 dias el saldo proyectado ($%s) apenas cubre nomina quincenal ($%s).',
      to_char(v_saldo_15d, 'FM999,999,999'), to_char(v_nomina_mensual / 2, 'FM999,999,999'));
    v_severidad := 'high';
  ELSIF v_saldo_30d < 0 THEN
    v_alerta := format('PRECAUCION: En 30 dias el saldo proyectado es -%s. Revisar cobranza.',
      to_char(abs(v_saldo_30d), 'FM999,999,999'));
    v_severidad := 'medium';
  ELSE
    v_alerta := format('OK: Saldo proyectado a 30d es $%s. Runway: %s dias.',
      to_char(v_saldo_30d, 'FM999,999,999'), v_dias_runway);
    v_severidad := 'low';
  END IF;

  RETURN jsonb_build_object(
    'efectivo_actual', v_cash,
    'nomina_mensual_estimada', v_nomina_mensual,
    'proyeccion_7d', jsonb_build_object(
      'cobros_esperados', v_cobros_7d,
      'pagos_esperados', v_pagos_7d,
      'saldo_proyectado', v_saldo_7d
    ),
    'proyeccion_15d', jsonb_build_object(
      'cobros_esperados', v_cobros_15d,
      'pagos_esperados', v_pagos_15d,
      'nomina_quincenal', round(v_nomina_mensual / 2),
      'saldo_proyectado', v_saldo_15d
    ),
    'proyeccion_30d', jsonb_build_object(
      'cobros_esperados', v_cobros_30d,
      'pagos_esperados', v_pagos_30d,
      'nomina_mensual', v_nomina_mensual,
      'saldo_proyectado', v_saldo_30d
    ),
    'dias_runway', v_dias_runway,
    'alerta', v_alerta,
    'severidad', v_severidad
  );
END;
$$;


-- ═══════════════════════════════════════════════════════════════
-- 3. TABLE: budgets (presupuesto mensual por cuenta contable)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS budgets (
  id bigserial PRIMARY KEY,
  odoo_account_id int,              -- FK to chart of accounts
  account_code text NOT NULL,       -- e.g. '601.01'
  account_name text,                -- e.g. 'Sueldos y Salarios'
  period text NOT NULL,             -- e.g. 'April 2026'
  budget_amount numeric NOT NULL DEFAULT 0,
  notes text,
  created_by text,                  -- who entered it
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(account_code, period)
);

CREATE INDEX IF NOT EXISTS idx_budgets_period ON budgets(period);
CREATE INDEX IF NOT EXISTS idx_budgets_account ON budgets(account_code);

ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'budgets' AND policyname = 'anon_read_budgets'
  ) THEN
    CREATE POLICY "anon_read_budgets" ON budgets FOR SELECT TO anon USING (true);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'budgets' AND policyname = 'service_all_budgets'
  ) THEN
    CREATE POLICY "service_all_budgets" ON budgets FOR ALL TO service_role USING (true);
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════
-- 4. VIEW: budget_vs_actual
--    Cruzar presupuesto mensual vs balance real por cuenta
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW budget_vs_actual AS
SELECT
  b.period,
  b.account_code,
  COALESCE(b.account_name, a.account_name) AS account_name,
  COALESCE(a.account_type, '') AS account_type,
  b.budget_amount AS presupuesto,
  COALESCE(a.balance, 0) AS real,
  COALESCE(a.balance, 0) - b.budget_amount AS desviacion,
  CASE
    WHEN b.budget_amount > 0
    THEN round(((COALESCE(a.balance, 0) - b.budget_amount) / b.budget_amount * 100)::numeric, 1)
    ELSE NULL
  END AS desviacion_pct,
  CASE
    WHEN b.budget_amount > 0 AND COALESCE(a.balance, 0) > b.budget_amount * 1.1 THEN 'EXCESO >10%'
    WHEN b.budget_amount > 0 AND COALESCE(a.balance, 0) < b.budget_amount * 0.5 THEN 'SUBEJERCIDO <50%'
    ELSE 'EN RANGO'
  END AS status,
  b.notes
FROM budgets b
LEFT JOIN odoo_account_balances a
  ON a.account_code = b.account_code
  AND a.period = b.period
ORDER BY b.period DESC, abs(COALESCE(a.balance, 0) - b.budget_amount) DESC;


-- ═══════════════════════════════════════════════════════════════
-- 5. VIEW: CFDI ↔ Invoice cross-reference via UUID
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW cfdi_invoice_match AS
SELECT
  c.id AS cfdi_id,
  c.uuid AS cfdi_uuid,
  c.emisor_rfc,
  c.emisor_nombre,
  c.receptor_rfc,
  c.receptor_nombre,
  c.tipo_comprobante,
  c.total AS cfdi_total,
  c.fecha AS cfdi_fecha,
  c.serie,
  c.folio,
  i.id AS invoice_id,
  i.name AS invoice_name,
  i.amount_total AS invoice_total,
  i.invoice_date,
  i.payment_state,
  i.days_overdue,
  CASE
    WHEN i.id IS NOT NULL THEN 'matched'
    WHEN c.uuid IS NULL THEN 'no_uuid'
    ELSE 'unmatched'
  END AS match_status,
  -- Amount validation
  CASE
    WHEN i.id IS NOT NULL AND abs(c.total - i.amount_total) > 1 THEN 'MONTO_DIFERENTE'
    WHEN i.id IS NOT NULL THEN 'OK'
    ELSE NULL
  END AS amount_check
FROM cfdi_documents c
LEFT JOIN odoo_invoices i ON lower(c.uuid) = lower(i.cfdi_uuid)
ORDER BY c.fecha DESC;


-- Reload PostgREST schema
NOTIFY pgrst, 'reload schema';
