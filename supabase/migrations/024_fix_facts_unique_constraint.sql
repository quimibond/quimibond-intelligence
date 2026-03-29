-- ============================================================
-- Migration 024: Fix facts unique constraint for PostgREST
-- ============================================================
-- Applied via Supabase MCP on 2026-03-29.
--
-- Problem: batch_save_facts() used on_conflict=fact_hash but the
-- unique index uq_facts_hash was PARTIAL (WHERE fact_hash IS NOT NULL).
-- PostgREST cannot use partial unique indexes for ON CONFLICT resolution,
-- so every fact INSERT silently failed with the error being swallowed.
-- Result: 705 entities + 762 relationships existed, but 0 facts.
--
-- Fix: Replace partial unique index with full unique constraint.
-- Also reset kg_processed on all emails so pipeline can re-extract facts.
-- ============================================================

DROP INDEX IF EXISTS uq_facts_hash;
DROP INDEX IF EXISTS idx_facts_hash;

ALTER TABLE facts ADD CONSTRAINT uq_facts_hash UNIQUE (fact_hash);

UPDATE emails SET kg_processed = false WHERE kg_processed = true;
