-- supabase/migrations/1052_silver_sp4_evidence_tables.sql
--
-- Silver SP4 — Task 13: evidence tables (email_signals, attachments, manual_notes)
-- Spec §8; Plan Task 13.
-- Polymorphic FK pattern: (canonical_entity_type, canonical_entity_id) — TEXT id because
-- canonical_companies/contacts/products use bigint PK but canonical_invoices/payments/credit_notes/tax_events use text PK.

BEGIN;

-- ===== email_signals =================================================
CREATE TABLE IF NOT EXISTS email_signals (
  id                     bigserial PRIMARY KEY,
  canonical_entity_type  text NOT NULL,
  canonical_entity_id    text NOT NULL,
  signal_type            text NOT NULL,
  email_id               bigint NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  thread_id              bigint REFERENCES threads(id) ON DELETE SET NULL,
  signal_value           text,
  confidence             numeric(4,3),
  extracted_at           timestamptz NOT NULL DEFAULT now(),
  expires_at             timestamptz
);
CREATE INDEX IF NOT EXISTS email_signals_entity_idx
  ON email_signals (canonical_entity_type, canonical_entity_id);
CREATE INDEX IF NOT EXISTS email_signals_email_idx
  ON email_signals (email_id);
CREATE INDEX IF NOT EXISTS email_signals_thread_idx
  ON email_signals (thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_signals_type_idx
  ON email_signals (signal_type);

COMMENT ON TABLE email_signals IS
  'Silver SP4 Evidence — email-derived signals attached polymorphically to canonical entities.';

-- ===== attachments ===================================================
CREATE TABLE IF NOT EXISTS attachments (
  id                     bigserial PRIMARY KEY,
  canonical_entity_type  text NOT NULL,
  canonical_entity_id    text NOT NULL,
  attachment_type        text NOT NULL,
  storage_path           text,
  syntage_file_id        bigint,
  email_id               bigint REFERENCES emails(id) ON DELETE SET NULL,
  filename               text,
  mime_type              text,
  size_bytes             bigint,
  metadata               jsonb,
  uploaded_by            text,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attachments_entity_idx
  ON attachments (canonical_entity_type, canonical_entity_id);
CREATE INDEX IF NOT EXISTS attachments_syntage_file_idx
  ON attachments (syntage_file_id) WHERE syntage_file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS attachments_type_idx
  ON attachments (attachment_type);

COMMENT ON TABLE attachments IS
  'Silver SP4 Evidence — files linked to canonical entities (CFDI XML/PDF, etc).';

-- ===== manual_notes ==================================================
CREATE TABLE IF NOT EXISTS manual_notes (
  id                     bigserial PRIMARY KEY,
  canonical_entity_type  text NOT NULL,
  canonical_entity_id    text NOT NULL,
  note_type              text NOT NULL DEFAULT 'general',
  body                   text NOT NULL,
  created_by             text NOT NULL,
  pinned                 boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS manual_notes_entity_idx
  ON manual_notes (canonical_entity_type, canonical_entity_id);
CREATE INDEX IF NOT EXISTS manual_notes_pinned_idx
  ON manual_notes (pinned) WHERE pinned = true;

CREATE OR REPLACE FUNCTION manual_notes_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_manual_notes_updated_at ON manual_notes;
CREATE TRIGGER trg_manual_notes_updated_at
BEFORE UPDATE ON manual_notes
FOR EACH ROW EXECUTE FUNCTION manual_notes_touch_updated_at();

COMMENT ON TABLE manual_notes IS
  'Silver SP4 Evidence — freeform notes attached to canonical entities by operators.';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT t, 'email_signals', d, sql, tb, true FROM (
  VALUES ('CREATE_TABLE',
          'Evidence layer email_signals',
          'supabase/migrations/1052_silver_sp4_evidence_tables.sql',
          'silver-sp4-task-13')
) v(t, d, sql, tb)
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by='silver-sp4-task-13' AND table_name='email_signals');

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE_TABLE', 'attachments', 'Evidence layer attachments',
       'supabase/migrations/1052_silver_sp4_evidence_tables.sql', 'silver-sp4-task-13', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by='silver-sp4-task-13' AND table_name='attachments');

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE_TABLE', 'manual_notes', 'Evidence layer manual_notes',
       'supabase/migrations/1052_silver_sp4_evidence_tables.sql', 'silver-sp4-task-13', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by='silver-sp4-task-13' AND table_name='manual_notes');

COMMIT;
