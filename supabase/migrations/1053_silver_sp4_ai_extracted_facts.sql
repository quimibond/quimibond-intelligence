-- supabase/migrations/1053_silver_sp4_ai_extracted_facts.sql
--
-- Silver SP4 — Task 14: ai_extracted_facts table (schema only)
-- Spec §8.2; Plan Task 14.
-- Data migration lives in Task 15 (separate gate).

BEGIN;

CREATE TABLE IF NOT EXISTS ai_extracted_facts (
  id                    bigserial PRIMARY KEY,
  canonical_entity_type text NOT NULL,
  canonical_entity_id   text NOT NULL,
  fact_type             text NOT NULL,
  fact_text             text NOT NULL,
  fact_hash             text,
  fact_date             timestamptz,
  confidence            numeric(4,3) NOT NULL,
  source_type           text NOT NULL,
  source_account        text,
  source_ref            text,
  extraction_run_id     text,
  verified              boolean NOT NULL DEFAULT false,
  verification_source   text,
  verified_at           timestamptz,
  is_future             boolean NOT NULL DEFAULT false,
  expired               boolean NOT NULL DEFAULT false,
  superseded_by         bigint REFERENCES ai_extracted_facts(id),
  legacy_facts_id       bigint,
  extracted_at          timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_extracted_facts_entity_idx
  ON ai_extracted_facts (canonical_entity_type, canonical_entity_id);
CREATE INDEX IF NOT EXISTS ai_extracted_facts_type_idx
  ON ai_extracted_facts (fact_type);
CREATE UNIQUE INDEX IF NOT EXISTS ai_extracted_facts_hash_uidx
  ON ai_extracted_facts (fact_hash) WHERE fact_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_extracted_facts_legacy_idx
  ON ai_extracted_facts (legacy_facts_id) WHERE legacy_facts_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_extracted_facts_not_expired_idx
  ON ai_extracted_facts (canonical_entity_type, canonical_entity_id)
  WHERE expired = false AND superseded_by IS NULL;

COMMENT ON TABLE ai_extracted_facts IS
  'Silver SP4 Evidence — successor of facts. Polymorphic FK to canonical entities, with dedup + supersede.';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE_TABLE', 'ai_extracted_facts', 'Successor of facts (schema only; migration in Task 15)',
       'supabase/migrations/1053_silver_sp4_ai_extracted_facts.sql',
       'silver-sp4-task-14', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by = 'silver-sp4-task-14');

COMMIT;
