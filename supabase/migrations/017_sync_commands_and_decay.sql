-- ============================================================
-- Migration 017: sync_commands table + decay_fact_confidence RPC
-- ============================================================
-- sync_commands: bridge table for frontend → Odoo command dispatch.
--   Frontend inserts commands with status='pending'.
--   Odoo's run_supabase_sync cron picks them up and executes.
--
-- decay_fact_confidence: reduces confidence of unverified facts
--   over time, and removes very old low-confidence facts.
-- ============================================================

-- ── sync_commands table ──
CREATE TABLE IF NOT EXISTS sync_commands (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    command     TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    result      JSONB DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-update updated_at
CREATE OR REPLACE TRIGGER set_sync_commands_updated_at
    BEFORE UPDATE ON sync_commands
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Index for Odoo polling (pending commands)
CREATE INDEX IF NOT EXISTS idx_sync_commands_status
    ON sync_commands (status) WHERE status = 'pending';

-- RLS: allow authenticated and anon to insert/read/update
ALTER TABLE sync_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sync_commands_select" ON sync_commands
    FOR SELECT USING (true);

CREATE POLICY "sync_commands_insert" ON sync_commands
    FOR INSERT WITH CHECK (true);

CREATE POLICY "sync_commands_update" ON sync_commands
    FOR UPDATE USING (true);

-- ── decay_fact_confidence RPC ──
-- Reduces confidence of facts not verified in the last 30 days.
-- Facts with confidence < 0.1 and older than 90 days are removed.
CREATE OR REPLACE FUNCTION decay_fact_confidence()
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
    decayed_count INT;
    removed_count INT;
BEGIN
    -- Decay: reduce confidence by 10% for facts not updated in 30+ days
    UPDATE facts
    SET confidence = GREATEST(confidence * 0.9, 0.01),
        updated_at = now()
    WHERE updated_at < now() - INTERVAL '30 days'
      AND confidence > 0.01;
    GET DIAGNOSTICS decayed_count = ROW_COUNT;

    -- Remove: delete very low confidence facts older than 90 days
    DELETE FROM facts
    WHERE confidence < 0.1
      AND updated_at < now() - INTERVAL '90 days';
    GET DIAGNOSTICS removed_count = ROW_COUNT;

    RETURN json_build_object(
        'decayed', decayed_count,
        'removed', removed_count
    );
END;
$$;
