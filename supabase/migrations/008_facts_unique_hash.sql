-- Migration 008: Add unique constraint on facts.fact_hash for dedup
-- Prevents duplicate facts when pipeline re-processes emails.
-- Applied via Supabase MCP on 2026-03-26.

-- Partial unique index: only enforce uniqueness when fact_hash is set
CREATE UNIQUE INDEX IF NOT EXISTS uq_facts_hash
ON facts (fact_hash) WHERE fact_hash IS NOT NULL;

-- Also drop old expression-based briefings index (redundant after 007)
DROP INDEX IF EXISTS idx_briefings_unique_scope;
