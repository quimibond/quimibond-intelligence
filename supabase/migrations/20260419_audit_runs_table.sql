-- 20260419_audit_runs_table.sql
-- Tabla de resultados de auditoría de integridad Odoo↔Supabase.
-- Cada fila = una medición de un invariante en un bucket (mes/company/etc).

CREATE TABLE IF NOT EXISTS audit_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         uuid NOT NULL,
  run_at         timestamptz NOT NULL DEFAULT now(),
  source         text NOT NULL CHECK (source IN ('odoo','supabase')),
  model          text NOT NULL,
  invariant_key  text NOT NULL,
  bucket_key     text,
  odoo_value     numeric,
  supabase_value numeric,
  diff           numeric,
  severity       text NOT NULL CHECK (severity IN ('ok','warn','error')),
  date_from      date,
  date_to        date,
  details        jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS audit_runs_unique_idx
  ON audit_runs (run_id, source, model, invariant_key, COALESCE(bucket_key, ''));

CREATE INDEX IF NOT EXISTS audit_runs_run_at_idx ON audit_runs (run_at DESC);
CREATE INDEX IF NOT EXISTS audit_runs_severity_idx
  ON audit_runs (severity) WHERE severity <> 'ok';
CREATE INDEX IF NOT EXISTS audit_runs_run_id_idx ON audit_runs (run_id);

COMMENT ON TABLE audit_runs IS
  'Resultados de invariantes de auditoría de sincronización Odoo↔Supabase. Spec: docs/superpowers/specs/2026-04-19-sync-audit-design.md';

-- Tabla de tolerancias configurables por invariante
CREATE TABLE IF NOT EXISTS audit_tolerances (
  invariant_key  text PRIMARY KEY,
  abs_tolerance  numeric NOT NULL DEFAULT 0.01,
  pct_tolerance  numeric NOT NULL DEFAULT 0.001,
  notes          text
);

COMMENT ON TABLE audit_tolerances IS
  'Tolerancias por invariante. Si falta fila, aplican defaults globales abs=0.01, pct=0.001.';

-- Seed de overrides conocidos
INSERT INTO audit_tolerances (invariant_key, abs_tolerance, pct_tolerance, notes) VALUES
  ('invoice_lines.sum_subtotal_signed_mxn', 0.50, 0.005,
   'FX de documento puede diferir de FX al momento de audit'),
  ('order_lines.sum_subtotal_mxn', 0.50, 0.005,
   'Igual que invoice_lines por FX floating'),
  ('account_balances.inventory_accounts_balance', 1.00, 0.0005,
   'Redondeo contable'),
  ('account_balances.cogs_accounts_balance', 1.00, 0.0005, 'Redondeo contable'),
  ('account_balances.revenue_accounts_balance', 1.00, 0.0005, 'Redondeo contable'),
  ('bank_balances.native_balance_per_journal', 0.05, 0.0001,
   'Cuentas bancarias tienen centavos')
ON CONFLICT (invariant_key) DO NOTHING;
