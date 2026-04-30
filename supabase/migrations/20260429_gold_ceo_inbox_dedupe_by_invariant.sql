-- Rewrite gold_ceo_inbox to surface 1 representative row per invariant_key
-- so CEO sees unique problems, not duplicates of the same systemic issue.
--
-- Pre-fix: 50 rows hardcoded, 27 of them were identical-looking
-- inventory.move_without_accounting cards out of 239 total open issues.
-- Post-fix: ~21 unique invariant_keys × top-by-priority each → CEO sees
-- ONE card per problem class with aggregate count + impact.
--
-- The representative issue_id is the highest-priority unresolved issue
-- of each invariant; clicking it opens the existing detail page.
-- Adds two new columns: invariant_total_count, invariant_total_impact_mxn
-- for the UI to surface "+N more like this" badge later.
--
-- Also: fetchInboxItem() in src/lib/queries/intelligence/inbox.ts now
-- queries reconciliation_issues directly (not the view) so deep-linked
-- non-representative issue_ids still resolve to a detail page.

CREATE OR REPLACE VIEW gold_ceo_inbox AS
WITH agg AS (
  SELECT invariant_key,
         COUNT(*) AS invariant_total_count,
         SUM(impact_mxn) AS invariant_total_impact_mxn
  FROM reconciliation_issues
  WHERE resolved_at IS NULL
    AND invariant_key <> 'legacy.unclassified'
  GROUP BY invariant_key
),
ranked AS (
  SELECT ri.*,
         ROW_NUMBER() OVER (
           PARTITION BY ri.invariant_key
           ORDER BY ri.priority_score DESC NULLS LAST, ri.detected_at DESC
         ) AS rn
  FROM reconciliation_issues ri
  WHERE ri.resolved_at IS NULL
    AND ri.invariant_key <> 'legacy.unclassified'
)
SELECT r.issue_id,
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
       cct.display_name AS assignee_name,
       cct.primary_email AS assignee_email,
       r.metadata,
       r.detected_at,
       a.invariant_total_count,
       a.invariant_total_impact_mxn
FROM ranked r
JOIN agg a ON a.invariant_key = r.invariant_key
LEFT JOIN canonical_contacts cct ON cct.id = r.assignee_canonical_contact_id
WHERE r.rn = 1
ORDER BY r.priority_score DESC NULLS LAST, r.detected_at DESC
LIMIT 50;
