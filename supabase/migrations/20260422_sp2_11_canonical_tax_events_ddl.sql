BEGIN;

CREATE TABLE IF NOT EXISTS canonical_tax_events (
  canonical_id text PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type IN ('retention','tax_return','electronic_accounting')),
  sat_record_id text,

  -- === Retention fields ===
  retention_uuid text,
  tipo_retencion text,
  monto_total_retenido numeric(14,2),
  emisor_rfc text, receptor_rfc text,
  retention_fecha_emision timestamptz,

  -- === Tax return fields ===
  return_ejercicio integer,
  return_periodo text,
  return_impuesto text,
  return_tipo_declaracion text,
  return_fecha_presentacion timestamptz,
  return_monto_pagado numeric(14,2),
  return_numero_operacion text,

  -- === Electronic accounting fields ===
  acct_ejercicio integer,
  acct_periodo text,
  acct_record_type text,
  acct_tipo_envio text,
  acct_hash text,

  -- === Odoo reconciliation ===
  odoo_payment_id bigint,
  odoo_account_ids integer[],
  odoo_reconciled_amount numeric(14,2),
  reconciliation_diff_abs numeric(14,2)
    GENERATED ALWAYS AS (
      CASE
        WHEN event_type='retention' AND monto_total_retenido IS NOT NULL AND odoo_reconciled_amount IS NOT NULL
          THEN ABS(monto_total_retenido - odoo_reconciled_amount)
        WHEN event_type='tax_return' AND return_monto_pagado IS NOT NULL AND odoo_reconciled_amount IS NOT NULL
          THEN ABS(return_monto_pagado - odoo_reconciled_amount)
        ELSE NULL
      END
    ) STORED,

  -- === Meta ===
  sat_estado text,
  taxpayer_rfc text NOT NULL DEFAULT 'PNT920218IW5',
  has_odoo_match boolean DEFAULT false,
  needs_review boolean DEFAULT false,
  review_reason text[] DEFAULT '{}',
  source_hashes jsonb,
  last_reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_cte_type ON canonical_tax_events (event_type);
CREATE INDEX IF NOT EXISTS ix_cte_return_period ON canonical_tax_events (return_ejercicio, return_periodo)
  WHERE event_type='tax_return';
CREATE INDEX IF NOT EXISTS ix_cte_acct_period ON canonical_tax_events (acct_ejercicio, acct_periodo)
  WHERE event_type='electronic_accounting';
CREATE INDEX IF NOT EXISTS ix_cte_odoo_match ON canonical_tax_events (has_odoo_match) WHERE has_odoo_match=false;
CREATE INDEX IF NOT EXISTS ix_cte_retention_uuid ON canonical_tax_events (retention_uuid) WHERE retention_uuid IS NOT NULL;

CREATE OR REPLACE FUNCTION trg_canonical_tax_events_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cte_updated_at ON canonical_tax_events;
CREATE TRIGGER trg_cte_updated_at BEFORE UPDATE ON canonical_tax_events
  FOR EACH ROW EXECUTE FUNCTION trg_canonical_tax_events_updated_at();

COMMENT ON TABLE canonical_tax_events IS 'Silver SP2 Pattern A. Unified tax events (retention/tax_return/electronic_accounting) from SAT sources with Odoo reconciliation.';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_table','canonical_tax_events','SP2 Task 11: DDL','20260422_sp2_11_canonical_tax_events_ddl.sql','silver-sp2',true);

COMMIT;
