-- Migration 040 — Data quality monitoring (2026-04-12)
--
-- Creates a unified scorecard view + alerts function to monitor 19 data
-- quality metrics in real-time. Used by:
--   - /api/system/data-quality-check cron (every 6h)
--   - /system page DataQualityPanel component

DROP VIEW IF EXISTS data_quality_scorecard CASCADE;
CREATE OR REPLACE VIEW data_quality_scorecard AS
SELECT * FROM (
  -- FK integrity
  SELECT 'fk_integrity' as category, 'invoices_no_company' as metric,
    (SELECT count(*)::bigint FROM odoo_invoices WHERE company_id IS NULL) as value,
    0::bigint as threshold, 'critical' as severity,
    'Odoo invoices that cannot be attributed to a company' as description
  UNION ALL SELECT 'fk_integrity', 'orders_no_company',
    (SELECT count(*) FROM odoo_sale_orders WHERE company_id IS NULL),
    0, 'critical', 'Sale orders without company link'
  UNION ALL SELECT 'fk_integrity', 'action_items_pending_no_assignee',
    (SELECT count(*) FROM action_items WHERE assignee_email IS NULL AND state = 'pending'),
    0, 'critical', 'Pending action items with nobody assigned'
  UNION ALL SELECT 'fk_integrity', 'agent_insights_open_no_assignee',
    (SELECT count(*) FROM agent_insights WHERE assignee_email IS NULL AND state IN ('new','seen')),
    5, 'high', 'Open insights with no assignee'
  UNION ALL SELECT 'fk_integrity', 'emails_no_sender_contact',
    (SELECT count(*) FROM emails WHERE sender_contact_id IS NULL),
    100, 'medium', 'Emails from senders not yet in contacts table'
  UNION ALL SELECT 'fk_integrity', 'contacts_no_company',
    (SELECT count(*) FROM contacts WHERE company_id IS NULL AND contact_type != 'noise'),
    50, 'medium', 'Business contacts not linked to any company (excluding noise)'
  -- Duplicates
  UNION ALL SELECT 'duplicates', 'dup_companies_by_odoo_partner',
    (SELECT count(*) FROM (SELECT odoo_partner_id FROM companies WHERE odoo_partner_id IS NOT NULL GROUP BY odoo_partner_id HAVING count(*) > 1) d),
    0, 'critical', 'Multiple company records with same Odoo partner_id'
  UNION ALL SELECT 'duplicates', 'dup_contacts_by_odoo_partner',
    (SELECT count(*) FROM (SELECT odoo_partner_id FROM contacts WHERE odoo_partner_id IS NOT NULL GROUP BY odoo_partner_id HAVING count(*) > 1) d),
    0, 'critical', 'Multiple contacts with same Odoo partner_id'
  UNION ALL SELECT 'duplicates', 'dup_entities',
    (SELECT count(*) FROM (SELECT canonical_name, entity_type FROM entities GROUP BY canonical_name, entity_type HAVING count(*) > 1) d),
    0, 'high', 'Duplicate entities'
  -- Freshness
  UNION ALL SELECT 'freshness', 'emails_last_24h',
    GREATEST(0, 50 - (SELECT count(*) FROM emails WHERE created_at > now() - interval '24 hours'))::bigint,
    0, 'high', 'Emails below 50/day threshold'
  UNION ALL SELECT 'freshness', 'insights_last_24h',
    GREATEST(0, 5 - (SELECT count(*) FROM agent_insights WHERE created_at > now() - interval '24 hours'))::bigint,
    0, 'high', 'Insights below 5/day threshold'
  UNION ALL SELECT 'freshness', 'briefings_today',
    GREATEST(0, 1 - (SELECT count(*) FROM briefings WHERE briefing_date = CURRENT_DATE))::bigint,
    0, 'high', 'Daily briefing missing for today'
  UNION ALL SELECT 'freshness', 'revenue_metrics_stale_days',
    GREATEST(0, EXTRACT(day FROM now() - COALESCE((SELECT max(created_at) FROM revenue_metrics), now() - interval '999 days'))::bigint - 2),
    0, 'medium', 'Days past freshness SLA for revenue_metrics'
  UNION ALL SELECT 'freshness', 'pipeline_errors_24h',
    (SELECT count(*) FROM pipeline_logs WHERE level = 'error' AND created_at > now() - interval '24 hours'),
    0, 'high', 'Pipeline errors in last 24h'
  -- Business logic
  UNION ALL SELECT 'business_logic', 'overdue_invoices_miscalculated',
    (SELECT count(*) FROM odoo_invoices WHERE payment_state = 'not_paid' AND due_date < current_date AND (days_overdue IS NULL OR days_overdue = 0)),
    0, 'medium', 'Overdue invoices with incorrect days_overdue'
  UNION ALL SELECT 'business_logic', 'invoices_residual_gt_total',
    (SELECT count(*) FROM odoo_invoices WHERE amount_residual > amount_total AND amount_total > 0),
    0, 'high', 'Invoices where residual > total (impossible)'
  UNION ALL SELECT 'business_logic', 'facts_invalid_confidence',
    (SELECT count(*) FROM facts WHERE confidence < 0 OR confidence > 1),
    0, 'high', 'Facts with confidence outside [0,1]'
  -- Cost
  UNION ALL SELECT 'cost', 'tokens_24h_cost_usd',
    (SELECT round((
      COALESCE(SUM(input_tokens) filter (where model LIKE '%sonnet%'), 0) * 3.0 / 1000000
      + COALESCE(SUM(output_tokens) filter (where model LIKE '%sonnet%'), 0) * 15.0 / 1000000
      + COALESCE(SUM(input_tokens) filter (where model LIKE '%haiku%'), 0) * 0.80 / 1000000
      + COALESCE(SUM(output_tokens) filter (where model LIKE '%haiku%'), 0) * 4.0 / 1000000
    )::numeric, 0)::bigint
    FROM token_usage WHERE created_at > now() - interval '24 hours'),
    20, 'high', 'Estimated Claude API cost in last 24h (USD)'
) checks;

GRANT SELECT ON data_quality_scorecard TO anon, authenticated;

-- Alerts function: returns only failing checks
CREATE OR REPLACE FUNCTION data_quality_alerts()
RETURNS TABLE(category text, metric text, value bigint, threshold bigint, severity text, description text)
LANGUAGE sql STABLE AS $$
  SELECT category, metric, value, threshold, severity, description
  FROM data_quality_scorecard
  WHERE value > threshold
  ORDER BY
    CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
    value - threshold DESC;
$$;

GRANT EXECUTE ON FUNCTION data_quality_alerts() TO anon, authenticated;

-- Supporting views for /system and /agents pages
CREATE OR REPLACE VIEW claude_cost_summary AS
WITH cost_per_row AS (
  SELECT endpoint, model, created_at, input_tokens, output_tokens,
    CASE
      WHEN model LIKE '%sonnet%' THEN input_tokens::numeric * 3.0 / 1000000 + output_tokens::numeric * 15.0 / 1000000
      WHEN model LIKE '%haiku%' THEN input_tokens::numeric * 0.80 / 1000000 + output_tokens::numeric * 4.0 / 1000000
      WHEN model LIKE '%opus%' THEN input_tokens::numeric * 15.0 / 1000000 + output_tokens::numeric * 75.0 / 1000000
      ELSE 0
    END as cost_usd
  FROM token_usage
)
SELECT endpoint, model, count(*) as calls,
  sum(input_tokens)::bigint as total_input_tokens,
  sum(output_tokens)::bigint as total_output_tokens,
  round(sum(cost_usd)::numeric, 4) as total_cost_usd,
  round(sum(cost_usd) filter (where created_at > now() - interval '24 hours')::numeric, 4) as cost_24h,
  round(sum(cost_usd) filter (where created_at > now() - interval '7 days')::numeric, 4) as cost_7d,
  round(sum(cost_usd) filter (where created_at > now() - interval '30 days')::numeric, 4) as cost_30d,
  count(*) filter (where created_at > now() - interval '24 hours') as calls_24h,
  max(created_at) as last_call
FROM cost_per_row
GROUP BY endpoint, model
ORDER BY cost_7d DESC NULLS LAST;

GRANT SELECT ON claude_cost_summary TO anon, authenticated;

CREATE OR REPLACE VIEW agent_effectiveness AS
SELECT a.id as agent_id, a.slug, a.name, a.domain, a.is_active,
  count(i.id) as total_insights,
  count(i.id) filter (where i.created_at > now() - interval '7 days') as insights_7d,
  count(i.id) filter (where i.created_at > now() - interval '24 hours') as insights_24h,
  count(i.id) filter (where i.state = 'new') as state_new,
  count(i.id) filter (where i.state = 'seen') as state_seen,
  count(i.id) filter (where i.state = 'acted_on') as state_acted,
  count(i.id) filter (where i.state = 'dismissed') as state_dismissed,
  count(i.id) filter (where i.state = 'expired') as state_expired,
  count(i.id) filter (where i.state = 'archived') as state_archived,
  CASE WHEN count(i.id) filter (where i.state IN ('acted_on', 'dismissed', 'expired')) = 0 THEN NULL
    ELSE round((count(i.id) filter (where i.state = 'acted_on')::numeric
       / count(i.id) filter (where i.state IN ('acted_on', 'dismissed', 'expired'))) * 100, 1)
  END as acted_rate_pct,
  CASE WHEN count(i.id) filter (where i.state IN ('acted_on', 'dismissed')) = 0 THEN NULL
    ELSE round((count(i.id) filter (where i.state = 'dismissed')::numeric
       / count(i.id) filter (where i.state IN ('acted_on', 'dismissed'))) * 100, 1)
  END as dismiss_rate_pct,
  CASE WHEN count(i.id) filter (where i.state IN ('acted_on', 'dismissed', 'expired')) = 0 THEN NULL
    ELSE round((count(i.id) filter (where i.state = 'expired')::numeric
       / count(i.id) filter (where i.state IN ('acted_on', 'dismissed', 'expired'))) * 100, 1)
  END as expire_rate_pct,
  round(avg(i.confidence)::numeric, 2) as avg_confidence,
  round(avg(i.business_impact_estimate)::numeric, 0) as avg_impact_mxn,
  round(sum(i.business_impact_estimate) filter (where i.state = 'acted_on')::numeric, 0) as impact_delivered_mxn,
  round(sum(i.business_impact_estimate) filter (where i.state = 'expired')::numeric, 0) as impact_expired_mxn,
  (SELECT max(completed_at) FROM agent_runs WHERE agent_id = a.id) as last_run_at,
  (SELECT count(*) FROM agent_runs WHERE agent_id = a.id AND completed_at > now() - interval '24 hours') as runs_24h,
  (SELECT round(avg(duration_seconds)::numeric, 1) FROM agent_runs WHERE agent_id = a.id AND completed_at > now() - interval '7 days') as avg_duration_s
FROM ai_agents a
LEFT JOIN agent_insights i ON i.agent_id = a.id
WHERE a.archived_at IS NULL
GROUP BY a.id, a.slug, a.name, a.domain, a.is_active
ORDER BY insights_7d DESC NULLS LAST;

GRANT SELECT ON agent_effectiveness TO anon, authenticated;
