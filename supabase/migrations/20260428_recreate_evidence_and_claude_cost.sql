-- supabase/migrations/20260428_recreate_evidence_and_claude_cost.sql
--
-- Recreate 4 missing objects detected in P0-1 audit (2026-04-28):
--   - email_signals  (table, evidence layer SP4 §8)
--   - attachments    (table, evidence layer SP4 §8)
--   - manual_notes   (table, evidence layer SP4 §8)
--   - claude_cost_summary (view, /system Claude cost panel)
--
-- All 4 had migrations originally (1052 + 040) but disappeared from prod.
-- Code has live consumers: /inbox/insight/[id] (3 evidence tables) and
-- /system getCostBreakdown (claude_cost_summary). Without these objects
-- the inbox detail page returns empty arrays and /system shows $0 costs.
--
-- This migration is idempotent — IF NOT EXISTS / OR REPLACE everywhere.

BEGIN;

-- ============================================================
-- Evidence layer: email_signals + attachments + manual_notes
-- ============================================================

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

-- ============================================================
-- claude_cost_summary view (over token_usage)
-- ============================================================

CREATE OR REPLACE VIEW claude_cost_summary AS
WITH cost_per_row AS (
  SELECT endpoint, model, created_at, input_tokens, output_tokens,
    CASE
      WHEN model LIKE '%sonnet%' THEN input_tokens::numeric * 3.0 / 1000000 + output_tokens::numeric * 15.0 / 1000000
      WHEN model LIKE '%haiku%'  THEN input_tokens::numeric * 0.80 / 1000000 + output_tokens::numeric * 4.0 / 1000000
      WHEN model LIKE '%opus%'   THEN input_tokens::numeric * 15.0 / 1000000 + output_tokens::numeric * 75.0 / 1000000
      ELSE 0
    END as cost_usd
  FROM token_usage
)
SELECT endpoint, model, count(*) as calls,
  sum(input_tokens)::bigint  as total_input_tokens,
  sum(output_tokens)::bigint as total_output_tokens,
  round(sum(cost_usd)::numeric, 4) as total_cost_usd,
  round(sum(cost_usd) filter (where created_at > now() - interval '24 hours')::numeric, 4) as cost_24h,
  round(sum(cost_usd) filter (where created_at > now() - interval '7 days')::numeric, 4) as cost_7d,
  round(sum(cost_usd) filter (where created_at > now() - interval '30 days')::numeric, 4) as cost_30d,
  count(*) filter (where created_at > now() - interval '24 hours') as calls_24h,
  max(created_at) as last_call
FROM cost_per_row
GROUP BY endpoint, model
ORDER BY cost_7d DESC NULLS LAST;

GRANT SELECT ON claude_cost_summary TO anon, authenticated;

-- ============================================================
-- Audit trail
-- ============================================================

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES
  ('CREATE_TABLE', 'email_signals',  'Recreate evidence email_signals (P0-1 audit)',
   'supabase/migrations/20260428_recreate_evidence_and_claude_cost.sql',
   'audit-2026-04-28-p0-1', true),
  ('CREATE_TABLE', 'attachments',    'Recreate evidence attachments (P0-1 audit)',
   'supabase/migrations/20260428_recreate_evidence_and_claude_cost.sql',
   'audit-2026-04-28-p0-1', true),
  ('CREATE_TABLE', 'manual_notes',   'Recreate evidence manual_notes (P0-1 audit)',
   'supabase/migrations/20260428_recreate_evidence_and_claude_cost.sql',
   'audit-2026-04-28-p0-1', true),
  ('CREATE_VIEW',  'claude_cost_summary', 'Recreate claude_cost_summary view (P0-1 audit)',
   'supabase/migrations/20260428_recreate_evidence_and_claude_cost.sql',
   'audit-2026-04-28-p0-1', true);

COMMIT;
