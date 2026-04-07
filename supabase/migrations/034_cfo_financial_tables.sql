-- ============================================================================
-- Migration 034: CFO Financial Tables
--
-- Adds 4 new tables for full financial intelligence:
-- 1. odoo_account_payments — real payment records (not proxy from invoices)
-- 2. odoo_chart_of_accounts — plan de cuentas for P&L / Balance Sheet
-- 3. odoo_account_balances — monthly balances per account (P&L data)
-- 4. odoo_bank_balances — current cash position
--
-- Plus views for:
-- - P&L (Estado de Resultados)
-- - Expense breakdown
-- - Cash position summary
-- ============================================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. ACCOUNT PAYMENTS (real Odoo payment records)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS odoo_account_payments (
  id bigserial PRIMARY KEY,
  odoo_payment_id int NOT NULL,
  odoo_partner_id int,
  company_id bigint REFERENCES companies(id) ON DELETE SET NULL,
  name text,
  payment_type text,          -- inbound / outbound
  partner_type text,          -- customer / supplier
  amount numeric DEFAULT 0,
  amount_signed numeric,      -- company currency signed
  currency text DEFAULT 'MXN',
  date date,
  ref text,
  journal_name text,          -- bank journal name
  payment_method text,        -- transfer, check, etc
  state text,                 -- draft / in_process / paid / canceled
  is_matched boolean,         -- matched with bank statement
  is_reconciled boolean,      -- fully reconciled
  reconciled_invoices_count int DEFAULT 0,
  synced_at timestamptz DEFAULT now(),
  UNIQUE(odoo_payment_id)
);

CREATE INDEX IF NOT EXISTS idx_acct_payments_partner ON odoo_account_payments(odoo_partner_id);
CREATE INDEX IF NOT EXISTS idx_acct_payments_date ON odoo_account_payments(date);
CREATE INDEX IF NOT EXISTS idx_acct_payments_type ON odoo_account_payments(payment_type);
CREATE INDEX IF NOT EXISTS idx_acct_payments_journal ON odoo_account_payments(journal_name);
CREATE INDEX IF NOT EXISTS idx_acct_payments_company ON odoo_account_payments(company_id);

ALTER TABLE odoo_account_payments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'odoo_account_payments' AND policyname = 'anon_read_odoo_account_payments'
  ) THEN
    CREATE POLICY "anon_read_odoo_account_payments" ON odoo_account_payments FOR SELECT TO anon USING (true);
  END IF;
END $$;

-- Auto-link company_id
DROP TRIGGER IF EXISTS trg_auto_link_acct_payment_company ON odoo_account_payments;
CREATE TRIGGER trg_auto_link_acct_payment_company
  BEFORE INSERT OR UPDATE ON odoo_account_payments
  FOR EACH ROW
  EXECUTE FUNCTION auto_link_order_to_company();


-- ═══════════════════════════════════════════════════════════════
-- 2. CHART OF ACCOUNTS (plan de cuentas)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS odoo_chart_of_accounts (
  id bigserial PRIMARY KEY,
  odoo_account_id int NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  account_type text,          -- asset_receivable, asset_cash, expense, income, etc
  reconcile boolean DEFAULT false,
  deprecated boolean DEFAULT false,
  synced_at timestamptz DEFAULT now(),
  UNIQUE(odoo_account_id)
);

CREATE INDEX IF NOT EXISTS idx_chart_code ON odoo_chart_of_accounts(code);
CREATE INDEX IF NOT EXISTS idx_chart_type ON odoo_chart_of_accounts(account_type);

ALTER TABLE odoo_chart_of_accounts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'odoo_chart_of_accounts' AND policyname = 'anon_read_chart'
  ) THEN
    CREATE POLICY "anon_read_chart" ON odoo_chart_of_accounts FOR SELECT TO anon USING (true);
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════
-- 3. ACCOUNT BALANCES (monthly aggregated, for P&L)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS odoo_account_balances (
  id bigserial PRIMARY KEY,
  odoo_account_id int NOT NULL,
  account_code text,
  account_name text,
  account_type text,
  period text,                -- 'March 2026', 'April 2026'
  debit numeric DEFAULT 0,
  credit numeric DEFAULT 0,
  balance numeric DEFAULT 0,
  synced_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_balances_account ON odoo_account_balances(odoo_account_id);
CREATE INDEX IF NOT EXISTS idx_balances_period ON odoo_account_balances(period);
CREATE INDEX IF NOT EXISTS idx_balances_type ON odoo_account_balances(account_type);

ALTER TABLE odoo_account_balances ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'odoo_account_balances' AND policyname = 'anon_read_balances'
  ) THEN
    CREATE POLICY "anon_read_balances" ON odoo_account_balances FOR SELECT TO anon USING (true);
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════
-- 4. BANK BALANCES (current cash position)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS odoo_bank_balances (
  id bigserial PRIMARY KEY,
  odoo_journal_id int NOT NULL,
  name text,                  -- journal name (e.g. "Banco Banamex")
  journal_type text,          -- bank / cash
  currency text DEFAULT 'MXN',
  bank_account text,          -- account number
  current_balance numeric DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(odoo_journal_id)
);

ALTER TABLE odoo_bank_balances ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'odoo_bank_balances' AND policyname = 'anon_read_bank_balances'
  ) THEN
    CREATE POLICY "anon_read_bank_balances" ON odoo_bank_balances FOR SELECT TO anon USING (true);
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════
-- 5. VIEW: P&L (Estado de Resultados)
--    Groups account balances by income vs expense categories
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW pl_estado_resultados AS
SELECT
  period,
  -- INGRESOS (income accounts: balance is negative in Odoo, we flip sign)
  round(abs(sum(balance) FILTER (WHERE account_type LIKE 'income%'))::numeric, 2) AS ingresos,
  -- COSTO DE VENTAS (COGS)
  round(sum(balance) FILTER (WHERE account_type = 'expense_direct_cost')::numeric, 2) AS costo_ventas,
  -- GASTOS OPERATIVOS
  round(sum(balance) FILTER (WHERE account_type = 'expense' OR account_type = 'expense_depreciation')::numeric, 2) AS gastos_operativos,
  -- UTILIDAD BRUTA
  round((abs(sum(balance) FILTER (WHERE account_type LIKE 'income%'))
    - COALESCE(sum(balance) FILTER (WHERE account_type = 'expense_direct_cost'), 0))::numeric, 2) AS utilidad_bruta,
  -- UTILIDAD OPERATIVA (EBITDA approx)
  round((abs(sum(balance) FILTER (WHERE account_type LIKE 'income%'))
    - COALESCE(sum(balance) FILTER (WHERE account_type LIKE 'expense%'), 0))::numeric, 2) AS utilidad_operativa,
  -- OTROS (financial income/expense)
  round(sum(balance) FILTER (WHERE account_type IN ('income_other', 'expense_other'))::numeric, 2) AS otros_neto
FROM odoo_account_balances
GROUP BY period
ORDER BY period;


-- ═══════════════════════════════════════════════════════════════
-- 6. VIEW: Cash Position Summary
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW cash_position AS
SELECT
  name AS banco,
  journal_type AS tipo,
  currency AS moneda,
  bank_account AS cuenta,
  current_balance AS saldo,
  updated_at AS actualizado
FROM odoo_bank_balances
ORDER BY current_balance DESC;


-- ═══════════════════════════════════════════════════════════════
-- 7. VIEW: Expense Breakdown (desglose de gastos)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW expense_breakdown AS
SELECT
  account_code AS cuenta,
  account_name AS concepto,
  account_type AS tipo,
  period AS periodo,
  debit AS cargo,
  credit AS abono,
  balance AS saldo
FROM odoo_account_balances
WHERE account_type LIKE 'expense%'
ORDER BY balance DESC;


-- ═══════════════════════════════════════════════════════════════
-- 8. VIEW: Payment Analysis (real payments with details)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW payment_analysis AS
SELECT
  p.date AS fecha,
  p.name AS referencia,
  COALESCE(c.canonical_name, 'Sin empresa') AS empresa,
  p.payment_type AS tipo,
  p.partner_type AS contraparte,
  p.amount AS monto,
  p.currency AS moneda,
  p.journal_name AS banco,
  p.payment_method AS metodo_pago,
  p.state AS estado,
  p.is_reconciled AS conciliado,
  p.ref AS nota
FROM odoo_account_payments p
LEFT JOIN companies c ON c.id = p.company_id
ORDER BY p.date DESC;


-- ═══════════════════════════════════════════════════════════════
-- 9. VIEW: CFO Dashboard Summary
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW cfo_dashboard AS
SELECT
  -- Cash position
  (SELECT round(sum(current_balance)::numeric, 0) FROM odoo_bank_balances) AS efectivo_total,

  -- Accounts receivable
  (SELECT round(sum(amount_residual)::numeric, 0) FROM odoo_invoices
   WHERE move_type = 'out_invoice' AND payment_state IN ('not_paid', 'partial')
   AND amount_residual > 0) AS cuentas_por_cobrar,

  -- Accounts payable
  (SELECT round(sum(amount_residual)::numeric, 0) FROM odoo_invoices
   WHERE move_type = 'in_invoice' AND payment_state IN ('not_paid', 'partial')
   AND amount_residual > 0) AS cuentas_por_pagar,

  -- Overdue receivables
  (SELECT round(sum(amount_residual)::numeric, 0) FROM odoo_invoices
   WHERE move_type = 'out_invoice' AND payment_state IN ('not_paid', 'partial')
   AND days_overdue > 0 AND amount_residual > 0) AS cartera_vencida,

  -- Revenue last 30 days
  (SELECT round(sum(amount_total)::numeric, 0) FROM odoo_invoices
   WHERE move_type = 'out_invoice'
   AND invoice_date >= current_date - interval '30 days') AS ventas_30d,

  -- Collections last 30 days (real payments)
  (SELECT round(sum(amount)::numeric, 0) FROM odoo_account_payments
   WHERE payment_type = 'inbound' AND state = 'paid'
   AND date >= current_date - interval '30 days') AS cobros_30d,

  -- Payments to suppliers last 30 days
  (SELECT round(sum(amount)::numeric, 0) FROM odoo_account_payments
   WHERE payment_type = 'outbound' AND state = 'paid'
   AND date >= current_date - interval '30 days') AS pagos_prov_30d,

  -- Overdue clients count
  (SELECT count(DISTINCT odoo_partner_id) FROM odoo_invoices
   WHERE move_type = 'out_invoice' AND payment_state IN ('not_paid', 'partial')
   AND days_overdue > 0 AND amount_residual > 0) AS clientes_morosos;


-- Reload PostgREST schema for new tables and views
NOTIFY pgrst, 'reload schema';
