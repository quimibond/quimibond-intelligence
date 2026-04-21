BEGIN;

CREATE TABLE IF NOT EXISTS canonical_credit_notes (
  canonical_id text PRIMARY KEY,
  odoo_invoice_id bigint,
  sat_uuid text,
  direction text NOT NULL CHECK (direction IN ('issued','received')),
  move_type_odoo text,
  tipo_comprobante_sat text NOT NULL DEFAULT 'E',

  -- === Monto ===
  amount_total_odoo numeric(14,2),
  amount_total_sat numeric(14,2),
  amount_total_resolved numeric(14,2),
  amount_total_diff_abs numeric(14,2)
    GENERATED ALWAYS AS (
      CASE WHEN amount_total_odoo IS NOT NULL AND amount_total_sat IS NOT NULL
           THEN ABS(amount_total_odoo - amount_total_sat) END
    ) STORED,
  amount_total_mxn_odoo numeric(14,2),
  amount_total_mxn_sat numeric(14,2),
  amount_total_mxn_resolved numeric(14,2),

  -- === FX ===
  currency_odoo text,
  currency_sat text,
  tipo_cambio_sat numeric(18,6),

  -- === Link to source invoice ===
  related_invoice_uuid text,
  related_invoice_canonical_id text,
  tipo_relacion text,
  reversed_entry_id_odoo bigint,

  -- === Partners ===
  emisor_rfc text, emisor_nombre text,
  receptor_rfc text, receptor_nombre text,
  odoo_partner_id integer,
  -- TODO-SP3: swap to canonical_companies FK
  emisor_company_id bigint,
  receptor_company_id bigint,

  -- === Fechas ===
  invoice_date date,
  fecha_emision timestamptz, fecha_timbrado timestamptz, fecha_cancelacion timestamptz,

  -- === Estados ===
  state_odoo text, estado_sat text,
  state_mismatch boolean
    GENERATED ALWAYS AS (
      (state_odoo = 'cancel' AND estado_sat = 'vigente')
      OR (state_odoo = 'posted' AND estado_sat = 'cancelado')
    ) STORED,

  -- === Flags ===
  historical_pre_odoo boolean
    GENERATED ALWAYS AS (
      odoo_invoice_id IS NULL AND fecha_timbrado IS NOT NULL AND fecha_timbrado < '2021-01-01'::timestamptz
    ) STORED,
  pending_operationalization boolean
    GENERATED ALWAYS AS (
      sat_uuid IS NOT NULL AND odoo_invoice_id IS NULL AND fecha_timbrado >= '2021-01-01'::timestamptz
    ) STORED,

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

CREATE UNIQUE INDEX IF NOT EXISTS uq_ccn_sat ON canonical_credit_notes (sat_uuid) WHERE sat_uuid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ccn_odoo ON canonical_credit_notes (odoo_invoice_id) WHERE odoo_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ccn_related ON canonical_credit_notes (related_invoice_canonical_id);
CREATE INDEX IF NOT EXISTS ix_ccn_emisor ON canonical_credit_notes (emisor_company_id);
CREATE INDEX IF NOT EXISTS ix_ccn_direction_date ON canonical_credit_notes (direction, invoice_date DESC);
CREATE INDEX IF NOT EXISTS ix_ccn_pending_op ON canonical_credit_notes (pending_operationalization) WHERE pending_operationalization=true;
CREATE INDEX IF NOT EXISTS ix_ccn_state_mismatch ON canonical_credit_notes (state_mismatch) WHERE state_mismatch=true;

CREATE OR REPLACE FUNCTION trg_canonical_credit_notes_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ccn_updated_at ON canonical_credit_notes;
CREATE TRIGGER trg_ccn_updated_at BEFORE UPDATE ON canonical_credit_notes
  FOR EACH ROW EXECUTE FUNCTION trg_canonical_credit_notes_updated_at();

COMMENT ON TABLE canonical_credit_notes IS 'Silver SP2 Pattern A. Egresos (tipo=E / move_type in out_refund/in_refund). FK emisor_company_id/receptor_company_id: companies.id placeholder; SP3 swaps to canonical_companies.';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_table','canonical_credit_notes','SP2 Task 8: DDL','20260422_sp2_08_canonical_credit_notes_ddl.sql','silver-sp2',true);

COMMIT;
