-- Migration 007: Add upsert key to briefings
-- Prevents duplicate briefings when pipeline re-runs.
-- Applied via Supabase MCP on 2026-03-26.

-- Set existing NULLs to empty string
UPDATE briefings SET account = '' WHERE account IS NULL;

-- Make account NOT NULL with default ''
ALTER TABLE briefings ALTER COLUMN account SET DEFAULT '';
ALTER TABLE briefings ALTER COLUMN account SET NOT NULL;

-- Unique constraint for PostgREST on_conflict
ALTER TABLE briefings ADD CONSTRAINT uq_briefings_scope_date_account
  UNIQUE (scope, briefing_date, account);
