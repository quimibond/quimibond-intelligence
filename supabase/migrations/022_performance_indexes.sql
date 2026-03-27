-- Performance indexes for common query patterns
-- Migration 022: Optimize API sync and query performance

-- Composite index for email queries by date + account (used in analysis pipeline)
CREATE INDEX IF NOT EXISTS idx_emails_date_account
ON emails (email_date DESC, account);

-- Person profiles lookup by email (used in upsert_person_profile)
CREATE INDEX IF NOT EXISTS idx_contacts_email_lower
ON contacts (lower(email));

-- Entity relationships lookup (used in KG traversal)
CREATE INDEX IF NOT EXISTS idx_entity_relationships_entities
ON entity_relationships (entity_a_id, entity_b_id);

-- Facts lookup by entity + recency (used in entity intelligence)
CREATE INDEX IF NOT EXISTS idx_facts_entity_date
ON facts (entity_id, created_at DESC);

-- Alerts by state + date (used in dashboard and chat RAG context)
CREATE INDEX IF NOT EXISTS idx_alerts_state_created
ON alerts (state, created_at DESC);

-- HNSW vector index for semantic email search (pgvector)
-- Only create if embedding column exists and has data
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'emails' AND column_name = 'embedding'
  ) THEN
    -- Check if index already exists
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE indexname = 'idx_emails_embedding_hnsw'
    ) THEN
      EXECUTE 'CREATE INDEX idx_emails_embedding_hnsw ON emails USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)';
    END IF;
  END IF;
END $$;
