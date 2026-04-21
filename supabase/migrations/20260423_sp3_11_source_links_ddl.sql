BEGIN;

CREATE TABLE IF NOT EXISTS source_links (
  id bigserial PRIMARY KEY,
  canonical_entity_type text NOT NULL CHECK (canonical_entity_type IN ('company','contact','product','invoice','payment','credit_note','tax_event')),
  canonical_entity_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('odoo','sat','gmail','kg_entity','manual')),
  source_table text NOT NULL,
  source_id text NOT NULL,
  source_natural_key text,
  match_method text NOT NULL,
  match_confidence numeric(4,3) NOT NULL CHECK (match_confidence BETWEEN 0 AND 1),
  matched_at timestamptz NOT NULL DEFAULT now(),
  matched_by text,
  superseded_at timestamptz,
  notes text
);

CREATE INDEX IF NOT EXISTS ix_sl_entity ON source_links (canonical_entity_type, canonical_entity_id);
CREATE INDEX IF NOT EXISTS ix_sl_source ON source_links (source, source_id) WHERE superseded_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sl_entity_source_active
  ON source_links (canonical_entity_type, source, source_id) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_sl_match_method ON source_links (match_method);
CREATE INDEX IF NOT EXISTS ix_sl_natural_key ON source_links (source_natural_key) WHERE source_natural_key IS NOT NULL;

COMMENT ON TABLE source_links IS 'Silver SP3 §6.1. Traceability layer: one row per {canonical_entity, source, source_id} link.';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_table','source_links','SP3 Task 11: DDL','20260423_sp3_11_source_links_ddl.sql','silver-sp3',true);

COMMIT;
