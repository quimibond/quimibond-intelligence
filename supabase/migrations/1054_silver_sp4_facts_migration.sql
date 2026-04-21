-- supabase/migrations/1054_silver_sp4_facts_migration.sql
--
-- Silver SP4 — Task 15: migrate facts → ai_extracted_facts (31,849 rows)
-- Spec §8.2 (migration clause); Plan Task 15 (GATED, user approved Option B).
-- Enhanced resolution: Tier 1 (source_links) → Tier 2 (exact canonical_name) → Tier 3 (entity_kg fallback).
-- Side effect: Tier 2 matches are recorded back to source_links so future runs resolve via Tier 1.
--
-- Schema notes confirmed pre-run 2026-04-21:
--   entities.entity_type values: person (4080), company (3628), product (1669), machine (19),
--                                 raw_material (11), location (1)
--   source_links UNIQUE: uq_sl_entity_source_active (canonical_entity_type, source, source_id)
--                        WHERE superseded_at IS NULL
--   ai_extracted_facts UNIQUE: ai_extracted_facts_hash_uidx (fact_hash) WHERE fact_hash IS NOT NULL
--   facts columns: id, entity_id, fact_type, fact_text, fact_hash, fact_date, confidence, verified,
--                  verification_source, verification_date, is_future, expired, source_type,
--                  source_account, extracted_at, created_at, source_id
--
-- Execution approach: JOIN-based pre-computed resolution via a staging table (_sp4_staging)
-- to avoid 31k correlated subquery calls that caused MCP timeout.
-- The migration was applied in steps via execute_sql. This file documents the canonical SQL.
--
-- Results (applied 2026-04-21):
--   Tier 1 (source_links):       0 rows  (none populated pre-migration)
--   Tier 2 (exact name match): 12,869 rows → 700 unique entity→canonical source_links backfilled
--   Tier 3 (entity_kg fallback): 18,980 rows
--   ai_extracted_facts total:  31,849 rows (100% coverage)
--   source_links_kg_entity:       700 rows

-- Step 1: Build staging table with JOIN-based 3-tier resolution
DROP TABLE IF EXISTS _sp4_staging;
CREATE TABLE _sp4_staging (
  fact_id bigint,
  entity_id bigint,
  entity_canonical_name text,
  entity_type text,
  fact_type text,
  fact_text text,
  fact_hash text,
  fact_date timestamptz,
  confidence numeric,
  source_type text,
  source_account text,
  source_id bigint,
  verified boolean,
  verification_source text,
  verification_date timestamptz,
  is_future boolean,
  expired boolean,
  extracted_at timestamptz,
  created_at timestamptz,
  final_type text,
  final_id text,
  resolution_tier text,
  derived_hash text
);

INSERT INTO _sp4_staging
WITH
t2_company AS (
  SELECT DISTINCT ON (e.id) e.id AS entity_id, 'company'::text AS t2_type, cc.id::text AS t2_id
  FROM entities e
  JOIN canonical_companies cc ON LOWER(TRIM(cc.canonical_name)) = LOWER(TRIM(e.canonical_name))
  WHERE e.entity_type = 'company'
  ORDER BY e.id, cc.id
),
t2_person AS (
  SELECT DISTINCT ON (e.id) e.id AS entity_id, 'contact'::text AS t2_type, cct.id::text AS t2_id
  FROM entities e
  JOIN canonical_contacts cct ON LOWER(TRIM(cct.canonical_name)) = LOWER(TRIM(e.canonical_name))
  WHERE e.entity_type = 'person'
  ORDER BY e.id, cct.id
),
t2_product AS (
  SELECT DISTINCT ON (e.id) e.id AS entity_id, 'product'::text AS t2_type, cp.id::text AS t2_id
  FROM entities e
  JOIN canonical_products cp ON LOWER(TRIM(cp.canonical_name)) = LOWER(TRIM(e.canonical_name))
  WHERE e.entity_type = 'product'
  ORDER BY e.id, cp.id
),
t2_all AS (
  SELECT * FROM t2_company UNION ALL SELECT * FROM t2_person UNION ALL SELECT * FROM t2_product
),
t1_all AS (
  SELECT DISTINCT ON (source_id)
    source_id AS entity_id_str,
    canonical_entity_type AS t1_type,
    canonical_entity_id   AS t1_id
  FROM source_links
  WHERE source='kg_entity' AND source_table='entities'
    AND superseded_at IS NULL
    AND canonical_entity_type IN ('company','contact','product')
  ORDER BY source_id, match_confidence DESC NULLS LAST, id
),
resolved AS (
  SELECT
    f.id               AS fact_id,
    f.entity_id,
    e.canonical_name   AS entity_canonical_name,
    e.entity_type,
    f.fact_type, f.fact_text, f.fact_hash, f.fact_date, f.confidence,
    f.source_type, f.source_account, f.source_id,
    f.verified, f.verification_source, f.verification_date,
    f.is_future, f.expired, f.extracted_at, f.created_at,
    COALESCE(t1.t1_type, t2.t2_type, 'entity_kg') AS final_type,
    COALESCE(t1.t1_id,   t2.t2_id,   f.entity_id::text) AS final_id,
    CASE
      WHEN t1.t1_type IS NOT NULL THEN 'tier1_source_links'
      WHEN t2.t2_type IS NOT NULL THEN 'tier2_exact_canonical_name'
      ELSE 'tier3_entity_kg_fallback'
    END AS resolution_tier,
    md5(COALESCE(f.fact_hash,'') || '|' || f.id::text || '|' ||
        COALESCE(f.fact_type,'') || '|' ||
        LEFT(COALESCE(f.fact_text,''), 500)) AS derived_hash
  FROM facts f
  LEFT JOIN entities e ON e.id = f.entity_id
  LEFT JOIN t1_all t1 ON t1.entity_id_str = f.entity_id::text
  LEFT JOIN t2_all t2 ON t2.entity_id = f.entity_id
)
SELECT * FROM resolved;

-- Step 2: Insert into ai_extracted_facts
INSERT INTO ai_extracted_facts
  (canonical_entity_type, canonical_entity_id, fact_type, fact_text, fact_hash,
   fact_date, confidence, source_type, source_account, source_ref,
   verified, verification_source, verified_at, is_future, expired,
   legacy_facts_id, extracted_at, created_at)
SELECT
  s.final_type,
  s.final_id,
  s.fact_type,
  s.fact_text,
  s.derived_hash,
  s.fact_date,
  COALESCE(s.confidence, 0.5),
  COALESCE(s.source_type, 'legacy'),
  s.source_account,
  CASE WHEN s.source_id IS NOT NULL THEN s.source_id::text END,
  COALESCE(s.verified, false),
  s.verification_source,
  s.verification_date,
  COALESCE(s.is_future, false),
  COALESCE(s.expired, false),
  s.fact_id,
  COALESCE(s.extracted_at, s.created_at, now()),
  COALESCE(s.created_at, now())
FROM _sp4_staging s
ON CONFLICT (fact_hash) WHERE fact_hash IS NOT NULL DO NOTHING;

-- Step 3: Backfill source_links for Tier-2 matches
INSERT INTO source_links
  (canonical_entity_type, canonical_entity_id, source, source_table,
   source_id, source_natural_key, match_method, match_confidence,
   matched_at, matched_by, notes)
SELECT DISTINCT
  s.final_type,
  s.final_id,
  'kg_entity',
  'entities',
  s.entity_id::text,
  s.entity_canonical_name,
  'name_exact_canonical',
  0.92,
  now(),
  'silver-sp4-task-15',
  'Task 15 migration — backfilled from facts table canonical_name exact match'
FROM _sp4_staging s
WHERE s.resolution_tier = 'tier2_exact_canonical_name'
  AND s.entity_id IS NOT NULL
ON CONFLICT (canonical_entity_type, source, source_id) WHERE superseded_at IS NULL
DO NOTHING;

-- Step 4: Audit records
INSERT INTO audit_runs (run_id, source, model, invariant_key, bucket_key, severity, details)
SELECT gen_random_uuid(), 'supabase', 'silver_sp4', 'sp4.facts_migration', 'sp4_task_15', 'ok',
       jsonb_build_object(
         'label',                 'task_15_facts_migration',
         'facts_src',             (SELECT COUNT(*) FROM facts),
         'ai_extracted_facts_dst',(SELECT COUNT(*) FROM ai_extracted_facts),
         'source_links_after',    (SELECT COUNT(*) FROM source_links WHERE source='kg_entity'),
         'resolution_tier_breakdown', (SELECT jsonb_object_agg(resolution_tier, cnt)
                                        FROM (SELECT resolution_tier, COUNT(*) cnt
                                              FROM _sp4_staging GROUP BY 1) x),
         'target_distribution',   (SELECT jsonb_object_agg(canonical_entity_type, c)
                                    FROM (SELECT canonical_entity_type, COUNT(*) c
                                            FROM ai_extracted_facts GROUP BY 1) x)
       );

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'MIGRATE_DATA', 'ai_extracted_facts',
       'Task 15: 3-tier facts→ai_extracted_facts migration + source_links backfill',
       'supabase/migrations/1054_silver_sp4_facts_migration.sql',
       'silver-sp4-task-15', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by='silver-sp4-task-15');

-- Step 5: Drop staging table
DROP TABLE IF EXISTS _sp4_staging;
