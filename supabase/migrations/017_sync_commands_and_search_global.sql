-- ============================================================
-- Migration 017: sync_commands table + search_global RPC
-- ============================================================
-- sync_commands: bridge table for frontend → Odoo command dispatch.
--   Frontend inserts commands with status='pending'.
--   Odoo's run_supabase_sync cron picks them up and executes.
--
-- search_global: unified search across contacts, entities, alerts,
--   facts, and emails for the Cmd+K search dialog.
--
-- decay_fact_confidence: already exists (created manually).
--   Reduces confidence of unverified facts and returns count.
-- ============================================================

-- ── sync_commands table ──
CREATE TABLE IF NOT EXISTS sync_commands (
    id              BIGSERIAL PRIMARY KEY,
    command         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    requested_by    TEXT DEFAULT 'frontend',
    result          JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ
);

-- Index for Odoo polling (pending commands)
CREATE INDEX IF NOT EXISTS idx_sync_commands_status
    ON sync_commands (status) WHERE status = 'pending';

-- RLS
ALTER TABLE sync_commands ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sync_commands' AND policyname = 'anon_read_commands') THEN
    CREATE POLICY "anon_read_commands" ON sync_commands FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sync_commands' AND policyname = 'anon_insert_commands') THEN
    CREATE POLICY "anon_insert_commands" ON sync_commands FOR INSERT WITH CHECK (status = 'pending');
  END IF;
END $$;

-- ── search_global RPC ──
CREATE OR REPLACE FUNCTION search_global(query text, max_results int DEFAULT 15)
RETURNS json
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  pattern text := '%' || query || '%';
  lim int := LEAST(max_results, 20);
  result json;
BEGIN
  SELECT json_build_object(
    'contacts', COALESCE((
      SELECT json_agg(r) FROM (
        SELECT id, name, email, company_id, risk_level
        FROM contacts
        WHERE name ILIKE pattern OR email ILIKE pattern
        LIMIT lim
      ) r
    ), '[]'::json),
    'entities', COALESCE((
      SELECT json_agg(r) FROM (
        SELECT id, name, canonical_name, entity_type
        FROM entities
        WHERE name ILIKE pattern OR canonical_name ILIKE pattern
        LIMIT lim
      ) r
    ), '[]'::json),
    'alerts', COALESCE((
      SELECT json_agg(r) FROM (
        SELECT id, title, description, severity, state, created_at
        FROM alerts
        WHERE title ILIKE pattern OR description ILIKE pattern
        ORDER BY created_at DESC
        LIMIT lim
      ) r
    ), '[]'::json),
    'facts', COALESCE((
      SELECT json_agg(r) FROM (
        SELECT id, fact_text, confidence, entity_id, created_at
        FROM facts
        WHERE fact_text ILIKE pattern
        ORDER BY created_at DESC
        LIMIT lim
      ) r
    ), '[]'::json),
    'emails', COALESCE((
      SELECT json_agg(r) FROM (
        SELECT id, subject, snippet, sender, email_date
        FROM emails
        WHERE subject ILIKE pattern OR snippet ILIKE pattern OR sender ILIKE pattern
        ORDER BY email_date DESC
        LIMIT lim
      ) r
    ), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$$;
