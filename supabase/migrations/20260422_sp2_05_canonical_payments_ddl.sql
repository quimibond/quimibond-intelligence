BEGIN;

-- =========================================
-- canonical_payments
-- =========================================
CREATE TABLE IF NOT EXISTS canonical_payments (
  canonical_id text PRIMARY KEY,
  odoo_payment_id bigint,
  sat_uuid_complemento text,
  direction text NOT NULL CHECK (direction IN ('received','sent')),

  -- === Monto ===
  amount_odoo numeric(14,2),
  amount_sat numeric(14,2),
  amount_resolved numeric(14,2),
  amount_diff_abs numeric(14,2)
    GENERATED ALWAYS AS (
      CASE WHEN amount_odoo IS NOT NULL AND amount_sat IS NOT NULL
           THEN ABS(amount_odoo - amount_sat) END
    ) STORED,
  amount_has_discrepancy boolean
    GENERATED ALWAYS AS (
      amount_odoo IS NOT NULL AND amount_sat IS NOT NULL
      AND ABS(amount_odoo - amount_sat) > 0.01
    ) STORED,

  -- === MXN ===
  amount_mxn_odoo numeric(14,2),
  amount_mxn_sat numeric(14,2),
  amount_mxn_resolved numeric(14,2),

  -- === Moneda / FX ===
  currency_odoo text,
  currency_sat text,
  tipo_cambio_sat numeric(18,6),

  -- === Fechas ===
  payment_date_odoo date,
  fecha_pago_sat timestamptz,
  payment_date_resolved date,
  -- date_has_discrepancy: cannot be GENERATED STORED (timestamptz->date is STABLE). Trigger below computes.
  date_has_discrepancy boolean,

  -- === Forma pago / journal ===
  forma_pago_sat text,
  payment_method_odoo text,
  journal_name text,
  journal_type text,
  is_reconciled boolean,
  reconciled_invoices_count integer,

  -- === Counterparties ===
  rfc_emisor_cta_ord text,
  rfc_emisor_cta_ben text,
  num_operacion text,
  odoo_ref text,

  -- === Partner ===
  partner_name text,
  odoo_partner_id integer,
  -- TODO-SP3: swap to canonical_companies FK
  counterparty_company_id bigint,
  estado_sat text,

  -- === Allocations cache ===
  allocation_count integer,
  allocated_invoices_uuid text[],
  amount_allocated numeric(14,2),
  amount_unallocated numeric(14,2)
    GENERATED ALWAYS AS (amount_resolved - COALESCE(amount_allocated,0)) STORED,

  -- === Flags ===
  registered_but_not_fiscally_confirmed boolean
    GENERATED ALWAYS AS (
      odoo_payment_id IS NOT NULL AND sat_uuid_complemento IS NULL
    ) STORED,
  complement_without_payment boolean
    GENERATED ALWAYS AS (
      sat_uuid_complemento IS NOT NULL AND odoo_payment_id IS NULL
    ) STORED,

  -- === Presence & meta ===
  has_odoo_record boolean NOT NULL DEFAULT false,
  has_sat_record boolean NOT NULL DEFAULT false,
  has_manual_link boolean NOT NULL DEFAULT false,
  sources_present text[] NOT NULL DEFAULT '{}',
  sources_missing text[] NOT NULL DEFAULT '{}',
  completeness_score numeric(4,3),
  needs_review boolean DEFAULT false,
  review_reason text[] DEFAULT '{}',
  source_hashes jsonb,
  last_reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =========================================
-- canonical_payment_allocations
-- =========================================
CREATE TABLE IF NOT EXISTS canonical_payment_allocations (
  id bigserial PRIMARY KEY,
  payment_canonical_id text NOT NULL REFERENCES canonical_payments(canonical_id) ON DELETE CASCADE,
  invoice_canonical_id text NOT NULL,  -- NOT FK (historical_pre_odoo rows may exist)
  allocated_amount numeric(14,2) NOT NULL,
  currency text,
  source text NOT NULL CHECK (source IN ('sat_complemento','odoo_link','manual')),
  sat_saldo_anterior numeric(14,2),
  sat_saldo_insoluto numeric(14,2),
  sat_num_parcialidad integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =========================================
-- Indexes
-- =========================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_cpa_pair
  ON canonical_payment_allocations (payment_canonical_id, invoice_canonical_id, source);
CREATE INDEX IF NOT EXISTS ix_cpa_invoice
  ON canonical_payment_allocations (invoice_canonical_id);
CREATE INDEX IF NOT EXISTS ix_cpa_payment
  ON canonical_payment_allocations (payment_canonical_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_payments_sat
  ON canonical_payments (sat_uuid_complemento) WHERE sat_uuid_complemento IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_payments_odoo
  ON canonical_payments (odoo_payment_id) WHERE odoo_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_canonical_payments_counterparty
  ON canonical_payments (counterparty_company_id);
CREATE INDEX IF NOT EXISTS ix_canonical_payments_dir_date
  ON canonical_payments (direction, payment_date_resolved DESC);
CREATE INDEX IF NOT EXISTS ix_canonical_payments_reg_not_conf
  ON canonical_payments (registered_but_not_fiscally_confirmed) WHERE registered_but_not_fiscally_confirmed=true;
CREATE INDEX IF NOT EXISTS ix_canonical_payments_comp_no_pay
  ON canonical_payments (complement_without_payment) WHERE complement_without_payment=true;
CREATE INDEX IF NOT EXISTS ix_canonical_payments_num_op
  ON canonical_payments (num_operacion);
CREATE INDEX IF NOT EXISTS ix_canonical_payments_date_disc
  ON canonical_payments (date_has_discrepancy) WHERE date_has_discrepancy = true;

-- =========================================
-- updated_at trigger
-- =========================================
CREATE OR REPLACE FUNCTION trg_canonical_payments_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_canonical_payments_updated_at ON canonical_payments;
CREATE TRIGGER trg_canonical_payments_updated_at
  BEFORE UPDATE ON canonical_payments FOR EACH ROW
  EXECUTE FUNCTION trg_canonical_payments_updated_at();

-- =========================================
-- date_has_discrepancy auto-compute trigger
-- (timestamptz->date cast is STABLE, cannot use GENERATED STORED)
-- =========================================
CREATE OR REPLACE FUNCTION compute_canonical_payments_date_discrepancy() RETURNS trigger AS $$
BEGIN
  NEW.date_has_discrepancy :=
    NEW.payment_date_odoo IS NOT NULL
    AND NEW.fecha_pago_sat IS NOT NULL
    AND ABS(NEW.payment_date_odoo - NEW.fecha_pago_sat::date) > 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_canonical_payments_date_disc ON canonical_payments;
CREATE TRIGGER trg_canonical_payments_date_disc
  BEFORE INSERT OR UPDATE ON canonical_payments FOR EACH ROW
  EXECUTE FUNCTION compute_canonical_payments_date_discrepancy();

COMMENT ON TABLE canonical_payments IS 'Silver SP2 Pattern A. FKs counterparty_company_id currently points at companies.id; SP3 renames to canonical_companies FK.';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_table','canonical_payments','SP2 Task 5: canonical_payments + allocations DDL + date_disc trigger','20260422_sp2_05_canonical_payments_ddl.sql','silver-sp2',true);

COMMIT;

-- =========================================
-- Rollback plan (do not run in normal operation)
-- =========================================
-- DROP TABLE IF EXISTS canonical_payment_allocations CASCADE;
-- DROP TABLE IF EXISTS canonical_payments CASCADE;
-- DROP FUNCTION IF EXISTS trg_canonical_payments_updated_at();
-- DROP FUNCTION IF EXISTS compute_canonical_payments_date_discrepancy();
