-- SP3 Task 3: Shadow canonical_companies for SAT-only RFCs + blacklist aggregate
-- Applied: 2026-04-20
-- Migrations: 20260423_sp3_03_canonical_companies_shadows (main) +
--             20260423_sp3_03b_canonical_companies_shadows_fix104 (104 RFC-variant fix)

-- Pre-gate diagnostic result:
--   sat_rfcs_total=3357, already_matched=1195, need_shadow=2162

BEGIN;

-- 3a. Create shadows for unmatched RFCs (exclude SAT-generic placeholders)
WITH sat_rfcs AS (
  SELECT emisor_rfc AS rfc, emisor_nombre AS nombre, MIN(fecha_timbrado) AS first_seen, MAX(fecha_timbrado) AS last_seen, COUNT(*) AS cfdis
    FROM canonical_invoices
   WHERE emisor_rfc IS NOT NULL AND emisor_rfc NOT IN ('XEXX010101000','XAXX010101000')
   GROUP BY emisor_rfc, emisor_nombre
  UNION ALL
  SELECT receptor_rfc, receptor_nombre, MIN(fecha_timbrado), MAX(fecha_timbrado), COUNT(*)
    FROM canonical_invoices
   WHERE receptor_rfc IS NOT NULL AND receptor_rfc NOT IN ('XEXX010101000','XAXX010101000')
   GROUP BY receptor_rfc, receptor_nombre
),
deduped AS (
  SELECT rfc,
         (array_agg(nombre ORDER BY cfdis DESC NULLS LAST))[1] AS nombre,
         MIN(first_seen) AS first_seen,
         MAX(last_seen) AS last_seen,
         SUM(cfdis) AS cfdi_count
  FROM sat_rfcs
  WHERE rfc IS NOT NULL
  GROUP BY rfc
)
INSERT INTO canonical_companies (
  canonical_name, display_name, rfc,
  has_shadow_flag, shadow_reason,
  match_method, match_confidence,
  needs_review, review_reason,
  blacklist_first_flagged_at, blacklist_last_flagged_at,
  last_matched_at
)
SELECT
  LOWER(COALESCE(d.nombre, d.rfc)),
  COALESCE(d.nombre, d.rfc),
  d.rfc,
  true, 'sat_cfdi_only_post_2021',
  'sat_only', 0.50,
  true, ARRAY['sat_only_shadow'],
  d.first_seen, d.last_seen,
  now()
FROM deduped d
WHERE NOT EXISTS (SELECT 1 FROM canonical_companies cc WHERE cc.rfc = d.rfc)
ON CONFLICT (canonical_name) DO NOTHING;

-- 3a-fix: Insert the 104 RFC-variant shadows skipped by name conflict above.
-- These are typo-variant RFCs for the same person/company (e.g. PARB510616P90 vs PARB510615B90).
-- Use RFC-suffixed canonical_name to guarantee uniqueness while preserving original display_name.
WITH sat_rfcs AS (
  SELECT emisor_rfc AS rfc, emisor_nombre AS nombre, MIN(fecha_timbrado) AS first_seen, MAX(fecha_timbrado) AS last_seen, COUNT(*) AS cfdis
    FROM canonical_invoices
   WHERE emisor_rfc IS NOT NULL AND emisor_rfc NOT IN ('XEXX010101000','XAXX010101000')
   GROUP BY emisor_rfc, emisor_nombre
  UNION ALL
  SELECT receptor_rfc, receptor_nombre, MIN(fecha_timbrado), MAX(fecha_timbrado), COUNT(*)
    FROM canonical_invoices
   WHERE receptor_rfc IS NOT NULL AND receptor_rfc NOT IN ('XEXX010101000','XAXX010101000')
   GROUP BY receptor_rfc, receptor_nombre
),
deduped AS (
  SELECT rfc,
         (array_agg(NULLIF(TRIM(nombre),'') ORDER BY cfdis DESC NULLS LAST))[1] AS nombre,
         MIN(first_seen) AS first_seen,
         MAX(last_seen) AS last_seen,
         SUM(cfdis) AS cfdi_count
  FROM sat_rfcs
  WHERE rfc IS NOT NULL
  GROUP BY rfc
),
unmatched AS (
  SELECT u.rfc_in_ci FROM (
    SELECT emisor_rfc AS rfc_in_ci FROM canonical_invoices WHERE emisor_rfc IS NOT NULL AND emisor_rfc NOT IN ('XEXX010101000','XAXX010101000')
    UNION
    SELECT receptor_rfc FROM canonical_invoices WHERE receptor_rfc IS NOT NULL AND receptor_rfc NOT IN ('XEXX010101000','XAXX010101000')
  ) u
  WHERE u.rfc_in_ci NOT IN (SELECT rfc FROM canonical_companies WHERE rfc IS NOT NULL)
)
INSERT INTO canonical_companies (
  canonical_name, display_name, rfc,
  has_shadow_flag, shadow_reason,
  match_method, match_confidence,
  needs_review, review_reason,
  blacklist_first_flagged_at, blacklist_last_flagged_at,
  last_matched_at
)
SELECT
  LOWER(COALESCE(d.nombre, d.rfc) || ' [' || d.rfc || ']'),
  COALESCE(d.nombre, d.rfc),
  d.rfc,
  true, 'sat_cfdi_only_post_2021',
  'sat_only', 0.50,
  true, ARRAY['sat_only_shadow','rfc_variant_name_conflict'],
  d.first_seen, d.last_seen,
  now()
FROM deduped d
JOIN unmatched u ON u.rfc_in_ci = d.rfc
ON CONFLICT (canonical_name) DO NOTHING;

-- 3b. Blacklist signal aggregate (applies to ALL canonical_companies)
-- Note: uses BOOL_OR pattern (not MAX) to correctly detect 'definitive'/'presumed' presence.
WITH bl AS (
  SELECT emisor_rfc AS rfc, emisor_blacklist_status AS level, COUNT(*) AS cnt,
         MIN(fecha_timbrado) AS first_flag, MAX(fecha_timbrado) AS last_flag
    FROM syntage_invoices
   WHERE emisor_blacklist_status IS NOT NULL AND emisor_blacklist_status <> 'none'
   GROUP BY emisor_rfc, emisor_blacklist_status
  UNION ALL
  SELECT receptor_rfc, receptor_blacklist_status, COUNT(*), MIN(fecha_timbrado), MAX(fecha_timbrado)
    FROM syntage_invoices
   WHERE receptor_blacklist_status IS NOT NULL AND receptor_blacklist_status <> 'none'
   GROUP BY receptor_rfc, receptor_blacklist_status
),
agg AS (
  SELECT rfc,
         CASE
           WHEN BOOL_OR(level='definitive') THEN 'definitive'
           WHEN BOOL_OR(level='presumed')   THEN 'presumed'
           ELSE 'none'
         END AS level,
         SUM(cnt)::integer AS cfdis_flagged_count,
         MIN(first_flag)   AS first_flag,
         MAX(last_flag)    AS last_flag
  FROM bl
  GROUP BY rfc
)
UPDATE canonical_companies cc
SET blacklist_level = agg.level,
    blacklist_cfdis_flagged_count = agg.cfdis_flagged_count,
    blacklist_first_flagged_at = agg.first_flag,
    blacklist_last_flagged_at = agg.last_flag
FROM agg
WHERE cc.rfc = agg.rfc AND agg.level <> 'none';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('populate','canonical_companies','SP3 Task 3: shadow creation + blacklist aggregate','20260423_sp3_03_canonical_companies_shadows.sql','silver-sp3',true);

COMMIT;
