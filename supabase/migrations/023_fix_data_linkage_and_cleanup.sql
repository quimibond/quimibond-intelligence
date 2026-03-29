-- ============================================================
-- Migration 023: Fix data linkage and cleanup
-- ============================================================
-- Applied via Supabase MCP on 2026-03-29.
--
-- Fixes:
-- 1. health_scores.contact_id was always NULL — resolved from contact_email
-- 2. Duplicate indexes removed (idx_emails_embedding, idx_companies_odoo_partner_nonunique)
-- 3. Column comments added for key fields
-- 4. Table comments added for communication_edges, email_recipients, sync_commands, token_usage
-- 5. Redundant get_team_dashboard() dropped (was just a wrapper for get_director_dashboard)
-- 6. resolve_all_connections() run to fill remaining data gaps
-- ============================================================

-- 1. Fix health_scores → contacts linkage
UPDATE health_scores hs
SET contact_id = c.id
FROM contacts c
WHERE hs.contact_email = c.email
  AND hs.contact_id IS NULL;

-- 2. Remove duplicate indexes
DROP INDEX IF EXISTS idx_emails_embedding;
DROP INDEX IF EXISTS idx_companies_odoo_partner_nonunique;

-- 3. Column comments
COMMENT ON COLUMN companies.canonical_name IS 'Lowercase normalized company name, used as natural upsert key';
COMMENT ON COLUMN companies.entity_id IS 'FK to KG entities table for company knowledge graph node';
COMMENT ON COLUMN contacts.entity_id IS 'FK to KG entities table for person knowledge graph node';
COMMENT ON COLUMN contacts.current_health_score IS 'Auto-synced from latest health_scores via trigger';
COMMENT ON COLUMN emails.embedding IS 'pgvector embedding (1536 dims) for semantic search, auto-generated';
COMMENT ON COLUMN emails.kg_processed IS 'Whether KG extraction has been run on this email';
COMMENT ON COLUMN facts.fact_hash IS 'SHA256 hash for deduplication of identical facts';
COMMENT ON COLUMN health_scores.contact_email IS 'Email used as lookup key (matches contacts.email)';
COMMENT ON COLUMN health_scores.contact_id IS 'FK to contacts, auto-resolved from contact_email';

-- 4. Table comments
COMMENT ON TABLE communication_edges IS 'Materialized email sender→recipient graph for network visualization.';
COMMENT ON TABLE email_recipients IS 'Resolved email recipients linked to contacts (junction table).';
COMMENT ON TABLE sync_commands IS 'Manual sync commands from frontend with status tracking.';
COMMENT ON TABLE token_usage IS 'Claude API token consumption tracking per endpoint.';

-- 5. Drop redundant function
DROP FUNCTION IF EXISTS get_team_dashboard();

-- 6. Run resolve_all_connections() to fill data gaps
SELECT resolve_all_connections();
