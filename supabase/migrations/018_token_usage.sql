-- ============================================================
-- Migration 018: Token usage tracking table
-- ============================================================
-- Tracks Claude API token usage per endpoint for cost monitoring.
-- Already applied in production via MCP.
-- ============================================================

CREATE TABLE IF NOT EXISTS token_usage (
    id              BIGSERIAL PRIMARY KEY,
    endpoint        TEXT NOT NULL,
    model           TEXT,
    input_tokens    INT NOT NULL DEFAULT 0,
    output_tokens   INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_token_usage_created_at ON token_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_usage_endpoint ON token_usage (endpoint);

ALTER TABLE token_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "token_usage_select" ON token_usage FOR SELECT USING (true);
CREATE POLICY "token_usage_insert" ON token_usage FOR INSERT WITH CHECK (true);
