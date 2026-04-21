-- supabase/migrations/1060_silver_sp4_gold_inbox_health.sql
--
-- Silver SP4 — Task 20: gold_ceo_inbox + gold_reconciliation_health
-- Spec §3.3, §9.5; Plan Task 20.

BEGIN;

DROP VIEW IF EXISTS gold_ceo_inbox;

CREATE VIEW gold_ceo_inbox AS
SELECT
  ri.issue_id,
  ri.issue_type,
  ri.invariant_key,
  ri.severity,
  ri.priority_score,
  ri.impact_mxn,
  ri.age_days,
  ri.description,
  ri.canonical_entity_type,
  ri.canonical_entity_id,
  ri.action_cta,
  ri.assignee_canonical_contact_id,
  cct.display_name       AS assignee_name,
  cct.primary_email      AS assignee_email,
  ri.metadata,
  ri.detected_at
FROM reconciliation_issues ri
LEFT JOIN canonical_contacts cct ON cct.id = ri.assignee_canonical_contact_id
WHERE ri.resolved_at IS NULL
  AND ri.invariant_key <> 'legacy.unclassified'
ORDER BY ri.priority_score DESC NULLS LAST, ri.detected_at DESC
LIMIT 50;

COMMENT ON VIEW gold_ceo_inbox IS
  'Top 50 open reconciliation issues ordered by priority_score. Assignee joined via canonical_contacts.';

DROP VIEW IF EXISTS gold_reconciliation_health;

CREATE VIEW gold_reconciliation_health AS
WITH by_invariant AS (
  SELECT invariant_key,
         severity,
         COUNT(*) FILTER (WHERE resolved_at IS NULL) AS open_cnt,
         COUNT(*) FILTER (WHERE resolved_at IS NOT NULL
                           AND resolution = 'auto')    AS auto_resolved_cnt,
         COUNT(*) FILTER (WHERE resolved_at IS NOT NULL
                           AND resolution <> 'auto')   AS manual_resolved_cnt,
         COUNT(*)                                       AS total_cnt,
         SUM(impact_mxn) FILTER (WHERE resolved_at IS NULL) AS open_impact_mxn,
         MAX(detected_at)                               AS last_detected
  FROM reconciliation_issues
  GROUP BY 1, 2
),
by_day AS (
  SELECT date_trunc('day', detected_at)::date AS day,
         severity,
         COUNT(*) FILTER (WHERE resolved_at IS NULL) AS still_open,
         COUNT(*) FILTER (WHERE resolved_at IS NOT NULL) AS closed
  FROM reconciliation_issues
  WHERE detected_at > now() - interval '30 days'
  GROUP BY 1, 2
)
SELECT
  (SELECT COUNT(*) FROM reconciliation_issues WHERE resolved_at IS NULL)            AS total_open,
  (SELECT SUM(impact_mxn) FROM reconciliation_issues WHERE resolved_at IS NULL)     AS total_open_impact_mxn,
  (SELECT COUNT(*) FROM reconciliation_issues
    WHERE resolved_at IS NULL AND severity='critical')                              AS critical_open,
  (SELECT COUNT(*) FROM reconciliation_issues
    WHERE resolved_at IS NULL AND severity='high')                                  AS high_open,
  (SELECT COUNT(*) FROM reconciliation_issues
    WHERE resolved_at > now() - interval '24 hours' AND resolution='auto')          AS auto_resolved_24h,
  (SELECT COUNT(*) FROM reconciliation_issues
    WHERE detected_at > now() - interval '24 hours' AND resolved_at IS NULL)        AS new_24h,
  (SELECT jsonb_agg(row_to_json(bi)) FROM (
     SELECT * FROM by_invariant ORDER BY open_cnt DESC LIMIT 20) bi)                AS top_invariants,
  (SELECT jsonb_agg(row_to_json(bd)) FROM (
     SELECT * FROM by_day ORDER BY day DESC) bd)                                    AS last_30d_trend,
  now()                                                                             AS refreshed_at;

COMMENT ON VIEW gold_reconciliation_health IS
  'Reconciliation engine health dashboard: open counts, auto-resolution rate, 30d trend.';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE_VIEW', 'gold_ceo_inbox', 'Gold: top 50 inbox',
       'supabase/migrations/1060_silver_sp4_gold_inbox_health.sql', 'silver-sp4-task-20', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes
                  WHERE triggered_by='silver-sp4-task-20' AND table_name='gold_ceo_inbox');

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE_VIEW', 'gold_reconciliation_health', 'Gold: engine health',
       'supabase/migrations/1060_silver_sp4_gold_inbox_health.sql', 'silver-sp4-task-20', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes
                  WHERE triggered_by='silver-sp4-task-20' AND table_name='gold_reconciliation_health');

COMMIT;
