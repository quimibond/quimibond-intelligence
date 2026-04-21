-- canonical_invoices (Pattern A) — Silver SP2 §5.1
BEGIN;

CREATE TABLE IF NOT EXISTS canonical_invoices (
  -- === Identity ===
  canonical_id text PRIMARY KEY,
  odoo_invoice_id bigint,
  sat_uuid text,
  direction text NOT NULL CHECK (direction IN ('issued','received','internal')),
  move_type_odoo text,
  tipo_comprobante_sat text,

  -- === Monto nativo ===
  amount_total_odoo numeric(14,2),
  amount_total_sat numeric(14,2),
  amount_total_resolved numeric(14,2),
  amount_total_diff_abs numeric(14,2)
    GENERATED ALWAYS AS (
      CASE WHEN amount_total_odoo IS NOT NULL AND amount_total_sat IS NOT NULL
           THEN ABS(amount_total_odoo - amount_total_sat) END
    ) STORED,
  amount_total_has_discrepancy boolean
    GENERATED ALWAYS AS (
      amount_total_odoo IS NOT NULL AND amount_total_sat IS NOT NULL
      AND ABS(amount_total_odoo - amount_total_sat) > 0.50
    ) STORED,
  amount_untaxed_odoo numeric(14,2),
  amount_untaxed_sat numeric(14,2),
  amount_tax_odoo numeric(14,2),
  amount_tax_sat numeric(14,2),
  amount_retenciones_sat numeric(14,2),

  -- === Residual / Payments ===
  amount_residual_odoo numeric(14,2),
  amount_residual_sat numeric(14,2),
  amount_paid_odoo numeric(14,2),
  amount_paid_sat numeric(14,2),
  amount_credited_sat numeric(14,2),
  amount_residual_resolved numeric(14,2),

  -- === MXN ===
  amount_total_mxn_odoo numeric(14,2),
  amount_total_mxn_sat numeric(14,2),
  amount_total_mxn_ops numeric(14,2),
  amount_total_mxn_fiscal numeric(14,2),
  amount_total_mxn_resolved numeric(14,2),
  amount_total_mxn_diff_abs numeric(14,2)
    GENERATED ALWAYS AS (
      CASE WHEN amount_total_mxn_odoo IS NOT NULL AND amount_total_mxn_sat IS NOT NULL
           THEN ABS(amount_total_mxn_odoo - amount_total_mxn_sat) END
    ) STORED,
  amount_total_mxn_diff_pct numeric(8,4)
    GENERATED ALWAYS AS (
      CASE WHEN amount_total_mxn_odoo IS NOT NULL AND amount_total_mxn_sat IS NOT NULL
                AND amount_total_mxn_sat <> 0
           THEN ROUND(100.0 * ABS(amount_total_mxn_odoo - amount_total_mxn_sat) / amount_total_mxn_sat, 4) END
    ) STORED,
  amount_residual_mxn_odoo numeric(14,2),
  amount_residual_mxn_resolved numeric(14,2),

  -- === Moneda / FX ===
  currency_odoo text,
  currency_sat text,
  tipo_cambio_odoo numeric(18,6),
  tipo_cambio_sat numeric(18,6),

  -- === Fechas ===
  invoice_date date,
  fecha_emision timestamptz,
  fecha_timbrado timestamptz,
  fecha_cancelacion timestamptz,
  due_date_odoo date,
  fiscal_due_date timestamptz,
  due_date_resolved date,
  fiscal_fully_paid_at timestamptz,
  fiscal_last_payment_date timestamptz,
  payment_date_odoo date,
  fiscal_days_to_full_payment integer,
  fiscal_days_to_due_date integer,
  -- NOTE: date_has_discrepancy is a regular column (not generated) because
  -- timestamptz::date is STABLE (timezone-dependent), not IMMUTABLE.
  -- Populated by Task 2/3 populate functions during INSERT/UPDATE.
  date_has_discrepancy boolean,

  -- === Estados ===
  state_odoo text,
  payment_state_odoo text,
  estado_sat text,
  cfdi_sat_state_odoo text,
  edi_state_odoo text,
  fiscal_cancellation_process_status text,
  state_mismatch boolean
    GENERATED ALWAYS AS (
      (state_odoo = 'cancel' AND estado_sat = 'vigente')
      OR (state_odoo = 'posted' AND estado_sat = 'cancelado')
    ) STORED,

  -- === Identificadores ===
  odoo_name text,
  cfdi_uuid_odoo text,
  serie text, folio text,
  odoo_ref text,

  -- === Partners ===
  emisor_rfc text,
  emisor_nombre text,
  receptor_rfc text,
  receptor_nombre text,
  odoo_partner_id integer,
  -- TODO-SP3: swap to canonical_companies FK (currently references companies.id as placeholder).
  emisor_company_id bigint,            -- REFERENCES companies(id); renamed to emisor_canonical_company_id in SP3
  receptor_company_id bigint,          -- REFERENCES companies(id)

  -- === 69B ===
  emisor_blacklist_status text,
  receptor_blacklist_status text,
  blacklist_action text
    GENERATED ALWAYS AS (
      CASE
        WHEN emisor_blacklist_status = 'definitive' OR receptor_blacklist_status = 'definitive' THEN 'block'
        WHEN emisor_blacklist_status = 'presumed'   OR receptor_blacklist_status = 'presumed'   THEN 'warning'
        ELSE NULL
      END
    ) STORED,

  -- === Metodo/forma pago + payment term ===
  metodo_pago text,
  forma_pago text,
  uso_cfdi text,
  payment_term_odoo text,
  fiscal_payment_terms_raw text,
  fiscal_payment_terms jsonb,

  -- === Salesperson ===
  salesperson_user_id integer,
  -- TODO-SP3: swap to canonical_contacts FK
  salesperson_contact_id bigint,

  -- === Flags historical ===
  historical_pre_odoo boolean
    GENERATED ALWAYS AS (
      odoo_invoice_id IS NULL AND fecha_timbrado IS NOT NULL AND fecha_timbrado < '2021-01-01'::timestamptz
    ) STORED,
  pending_operationalization boolean
    GENERATED ALWAYS AS (
      sat_uuid IS NOT NULL AND odoo_invoice_id IS NULL AND fecha_timbrado >= '2021-01-01'::timestamptz
    ) STORED,

  -- === Resolution tagging (composite match) ===
  resolved_from text,
  match_confidence text,
  match_evidence jsonb,

  -- === Presence & meta ===
  has_odoo_record boolean NOT NULL DEFAULT false,
  has_sat_record boolean NOT NULL DEFAULT false,
  has_email_thread boolean NOT NULL DEFAULT false,
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_invoices_sat_uuid
  ON canonical_invoices (sat_uuid) WHERE sat_uuid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_invoices_odoo_id
  ON canonical_invoices (odoo_invoice_id) WHERE odoo_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_canonical_invoices_emisor
  ON canonical_invoices (emisor_company_id);
CREATE INDEX IF NOT EXISTS ix_canonical_invoices_receptor
  ON canonical_invoices (receptor_company_id);
CREATE INDEX IF NOT EXISTS ix_canonical_invoices_direction_date
  ON canonical_invoices (direction, invoice_date DESC);
CREATE INDEX IF NOT EXISTS ix_canonical_invoices_needs_review
  ON canonical_invoices (needs_review) WHERE needs_review = true;
CREATE INDEX IF NOT EXISTS ix_canonical_invoices_pending_op
  ON canonical_invoices (pending_operationalization) WHERE pending_operationalization = true;
CREATE INDEX IF NOT EXISTS ix_canonical_invoices_state_mismatch
  ON canonical_invoices (state_mismatch) WHERE state_mismatch = true;
CREATE INDEX IF NOT EXISTS ix_canonical_invoices_amount_disc
  ON canonical_invoices (amount_total_has_discrepancy) WHERE amount_total_has_discrepancy = true;
CREATE INDEX IF NOT EXISTS ix_canonical_invoices_invoice_date
  ON canonical_invoices (invoice_date);
CREATE INDEX IF NOT EXISTS ix_canonical_invoices_fecha_timbrado
  ON canonical_invoices (fecha_timbrado);
CREATE INDEX IF NOT EXISTS ix_canonical_invoices_historical
  ON canonical_invoices (historical_pre_odoo) WHERE historical_pre_odoo = true;
CREATE INDEX IF NOT EXISTS ix_canonical_invoices_resolved_from
  ON canonical_invoices (resolved_from);

CREATE OR REPLACE FUNCTION trg_canonical_invoices_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_canonical_invoices_updated_at ON canonical_invoices;
CREATE TRIGGER trg_canonical_invoices_updated_at
  BEFORE UPDATE ON canonical_invoices
  FOR EACH ROW EXECUTE FUNCTION trg_canonical_invoices_updated_at();

COMMENT ON TABLE canonical_invoices IS 'Silver SP2 Pattern A. FKs emisor_company_id/receptor_company_id currently point at companies.id; SP3 renames to *_canonical_company_id with FK to canonical_companies.';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_table','canonical_invoices','SP2 Task 1: canonical_invoices DDL','20260422_sp2_01_canonical_invoices_ddl.sql','silver-sp2',true);

COMMIT;
