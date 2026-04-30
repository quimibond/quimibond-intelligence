-- Unify gold_ceo_inbox to surface BOTH:
--   1. Top-1 representative per invariant_key from reconciliation_issues
--      (silver invariants: operational/data integrity issues)
--   2. Director insights from agent_insights (state='new', confidence>=0.80,
--      excluding agent_id=8 = data_quality deterministic detector whose
--      monitoring outputs already surface as reconciliation_issues)
--
-- Why: Pre-fix, /inbox showed ONLY reconciliation_issues. Director outputs
-- (financiero, operaciones, riesgo, compliance, daily-digest, etc.) were
-- only visible in /, /directores/<slug>, breaking the user's mental model
-- where "Inbox" should be the single place to see what needs attention.
--
-- Schema: same row shape as before plus invariant_total_count and
-- invariant_total_impact_mxn (added in earlier dedupe migration).
-- issue_id type changed UUID → text so both UUID (reconciliation_issues)
-- and numeric agent_insights.id can fit. Detail page already routes
-- UUID→fetchInboxItem, numeric→getInsightById.
--
-- Score normalization for agent_insights:
--   severity_weight(critical=50,high=30,medium=10,low=2)
--   + confidence*5
--   + LEAST(15, log10(impact+1))
-- Result: agent critical conf=1.0 $10M ≈ 62 (top), comparable to
--         reconciliation top ~63.

DROP VIEW IF EXISTS gold_ceo_inbox;

CREATE VIEW gold_ceo_inbox AS
WITH agg AS (
  SELECT invariant_key,
         COUNT(*) AS invariant_total_count,
         SUM(impact_mxn) AS invariant_total_impact_mxn
  FROM reconciliation_issues
  WHERE resolved_at IS NULL
    AND invariant_key <> 'legacy.unclassified'
  GROUP BY invariant_key
),
ranked_recon AS (
  SELECT ri.*,
         ROW_NUMBER() OVER (
           PARTITION BY ri.invariant_key
           ORDER BY ri.priority_score DESC NULLS LAST, ri.detected_at DESC
         ) AS rn
  FROM reconciliation_issues ri
  WHERE ri.resolved_at IS NULL
    AND ri.invariant_key <> 'legacy.unclassified'
),
recon_rows AS (
  SELECT
    r.issue_id::text                                       AS issue_id,
    r.issue_type,
    r.invariant_key,
    r.severity,
    r.priority_score,
    r.impact_mxn,
    r.age_days,
    r.description,
    r.canonical_entity_type,
    r.canonical_entity_id,
    r.action_cta,
    r.assignee_canonical_contact_id,
    cct.display_name                                       AS assignee_name,
    cct.primary_email                                      AS assignee_email,
    r.metadata,
    r.detected_at,
    a.invariant_total_count,
    a.invariant_total_impact_mxn
  FROM ranked_recon r
  JOIN agg a ON a.invariant_key = r.invariant_key
  LEFT JOIN canonical_contacts cct ON cct.id = r.assignee_canonical_contact_id
  WHERE r.rn = 1
),
agent_rows AS (
  SELECT
    ai.id::text                                            AS issue_id,
    COALESCE('agent_insight.' || NULLIF(ai.insight_type,''), 'agent_insight') AS issue_type,
    'agent.' || aa.slug                                    AS invariant_key,
    ai.severity,
    (CASE ai.severity
        WHEN 'critical' THEN 50
        WHEN 'high'     THEN 30
        WHEN 'medium'   THEN 10
        WHEN 'low'      THEN 2
        ELSE 5
     END
     + COALESCE(ai.confidence, 0.5) * 5
     + LEAST(15, COALESCE(LOG(GREATEST(ai.business_impact_estimate, 1)), 0))
    )::numeric                                             AS priority_score,
    ai.business_impact_estimate                            AS impact_mxn,
    GREATEST(0, EXTRACT(DAY FROM (NOW() - ai.created_at))::int) AS age_days,
    COALESCE(ai.title, ai.description)                     AS description,
    NULL::text                                             AS canonical_entity_type,
    NULL::text                                             AS canonical_entity_id,
    NULL::text                                             AS action_cta,
    NULL::bigint                                           AS assignee_canonical_contact_id,
    ai.assignee_name,
    ai.assignee_email,
    COALESCE(ai.evidence, '{}'::jsonb)
      || jsonb_build_object(
           'source','agent_insight',
           'agent_slug', aa.slug,
           'insight_type', ai.insight_type,
           'category', ai.category,
           'recommendation', ai.recommendation,
           'confidence', ai.confidence
         )                                                 AS metadata,
    ai.created_at                                          AS detected_at,
    NULL::bigint                                           AS invariant_total_count,
    NULL::numeric                                          AS invariant_total_impact_mxn
  FROM agent_insights ai
  JOIN ai_agents aa ON aa.id = ai.agent_id
  WHERE ai.state = 'new'
    AND COALESCE(ai.confidence, 0) >= 0.80
    AND ai.agent_id <> 8
)
SELECT * FROM (
  SELECT * FROM recon_rows
  UNION ALL
  SELECT * FROM agent_rows
) u
ORDER BY priority_score DESC NULLS LAST, detected_at DESC
LIMIT 50;
