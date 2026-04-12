-- Migration 041 — Agent feedback loop (2026-04-12)
--
-- Fixes broken RPCs, adds follow-up ROI tracking, enrichment, and
-- optimized resolve_identities with batching.

-- ── Fix broken RPCs that referenced deleted 'alerts' table ─────────────

-- get_director_dashboard: rewritten to use agent_insights
CREATE OR REPLACE FUNCTION public.get_director_dashboard()
 RETURNS json
 LANGUAGE plpgsql
AS $function$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'kpi', (
      SELECT json_build_object(
        'open_alerts', (SELECT count(*) FROM agent_insights WHERE state IN ('new', 'seen') AND severity IN ('critical', 'high')),
        'critical_alerts', (SELECT count(*) FROM agent_insights WHERE severity = 'critical' AND state IN ('new', 'seen')),
        'pending_actions', (SELECT count(*) FROM action_items WHERE state IN ('pending', 'in_progress')),
        'overdue_actions', (SELECT count(*) FROM action_items WHERE state = 'pending' AND due_date < CURRENT_DATE),
        'at_risk_contacts', (SELECT count(*) FROM contacts WHERE risk_level IN ('high', 'critical')),
        'total_contacts', (SELECT count(*) FROM contacts WHERE contact_type = 'external'),
        'total_emails', (SELECT count(*) FROM emails),
        'completed_actions', (SELECT count(*) FROM action_items WHERE state = 'completed'),
        'resolved_alerts', (SELECT count(*) FROM agent_insights WHERE state IN ('acted_on', 'resolved'))
      )
    )
  ) INTO result;
  RETURN result;
END;
$function$;

-- Fix get_volume_trend(int) — was referencing non-existent response_metrics
DROP FUNCTION IF EXISTS get_volume_trend(integer);
CREATE OR REPLACE FUNCTION public.get_volume_trend(p_days integer DEFAULT 30)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE result json;
BEGIN
  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json) INTO result
  FROM (
    SELECT d.metric_date,
      count(*) FILTER (WHERE e.sender_type = 'external') AS emails_received,
      count(*) FILTER (WHERE e.sender_type = 'internal') AS emails_sent,
      count(DISTINCT e.gmail_thread_id) AS threads_active
    FROM generate_series(CURRENT_DATE - p_days, CURRENT_DATE, '1 day'::interval) d(metric_date)
    LEFT JOIN emails e ON e.email_date::date = d.metric_date
    GROUP BY d.metric_date ORDER BY d.metric_date
  ) t;
  RETURN result;
END;
$function$;

-- ── Optimized resolve_identities with batching ─────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_identities()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  step1_domain int := 0;
  step2_odoo_inherit int := 0;
  step4_odoo_to_company int := 0;
  step5_entity_companies int := 0;
  step6_entity_contacts int := 0;
  step7_domains int := 0;
  step8_emails_to_company int := 0;
BEGIN
  PERFORM set_limit(0.6);

  UPDATE contacts c SET company_id = co.id, updated_at = now()
  FROM companies co
  WHERE c.company_id IS NULL AND c.email IS NOT NULL AND c.email LIKE '%@%'
    AND co.domain IS NOT NULL AND co.domain != ''
    AND split_part(c.email, '@', 2) = co.domain;
  GET DIAGNOSTICS step1_domain = ROW_COUNT;

  UPDATE contacts c SET odoo_partner_id = co.odoo_partner_id, updated_at = now()
  FROM companies co
  WHERE c.odoo_partner_id IS NULL AND c.company_id IS NOT NULL
    AND c.company_id = co.id AND co.odoo_partner_id IS NOT NULL;
  GET DIAGNOSTICS step2_odoo_inherit = ROW_COUNT;

  -- Fuzzy match companies → entities (batched 100 per call for Vercel timeout)
  WITH orphan_batch AS (
    SELECT id, canonical_name FROM companies
    WHERE entity_id IS NULL AND canonical_name IS NOT NULL
    ORDER BY id LIMIT 100
  ),
  matches AS (
    SELECT DISTINCT ON (o.id) o.id AS company_id, e.id AS entity_id
    FROM orphan_batch o
    JOIN entities e ON e.entity_type = 'company'
      AND e.canonical_name IS NOT NULL AND o.canonical_name % e.canonical_name
    ORDER BY o.id, similarity(o.canonical_name, e.canonical_name) DESC
  )
  UPDATE companies co SET entity_id = m.entity_id, updated_at = now()
  FROM matches m WHERE co.id = m.company_id;
  GET DIAGNOSTICS step5_entity_companies = ROW_COUNT;

  UPDATE companies co SET entity_id = e.id, updated_at = now()
  FROM entities e
  WHERE co.entity_id IS NULL AND e.entity_type = 'company'
    AND e.odoo_id IS NOT NULL AND co.odoo_partner_id IS NOT NULL
    AND e.odoo_id = co.odoo_partner_id;

  UPDATE contacts c SET company_id = co.id, updated_at = now()
  FROM companies co
  WHERE c.company_id IS NULL AND c.odoo_partner_id IS NOT NULL
    AND co.odoo_partner_id = c.odoo_partner_id;
  GET DIAGNOSTICS step4_odoo_to_company = ROW_COUNT;

  UPDATE contacts c SET entity_id = e.id, updated_at = now()
  FROM entities e
  WHERE c.entity_id IS NULL AND c.email IS NOT NULL
    AND e.entity_type = 'person' AND e.email IS NOT NULL
    AND lower(c.email) = lower(e.email);
  GET DIAGNOSTICS step6_entity_contacts = ROW_COUNT;

  UPDATE companies co SET domain = sub.extracted_domain, updated_at = now()
  FROM (
    SELECT DISTINCT ON (c.company_id)
      c.company_id, split_part(c.email, '@', 2) AS extracted_domain
    FROM contacts c
    WHERE c.company_id IS NOT NULL AND c.email IS NOT NULL AND c.email LIKE '%@%'
      AND split_part(c.email, '@', 2) NOT IN (
        'gmail.com','hotmail.com','outlook.com','yahoo.com','live.com',
        'icloud.com','protonmail.com','aol.com','googlemail.com','msn.com',
        'mail.com','ymail.com','hotmail.es','outlook.es','yahoo.com.mx')
    ORDER BY c.company_id, c.updated_at DESC NULLS LAST
  ) sub
  WHERE co.id = sub.company_id AND (co.domain IS NULL OR co.domain = '');
  GET DIAGNOSTICS step7_domains = ROW_COUNT;

  -- Batched email linking (prevent timeout)
  WITH orphan_emails AS (
    SELECT em.id, c.company_id
    FROM emails em JOIN contacts c ON em.sender_contact_id = c.id
    WHERE em.company_id IS NULL AND em.sender_contact_id IS NOT NULL
      AND c.company_id IS NOT NULL
    LIMIT 2000
  )
  UPDATE emails em SET company_id = oe.company_id
  FROM orphan_emails oe WHERE em.id = oe.id;
  GET DIAGNOSTICS step8_emails_to_company = ROW_COUNT;

  RETURN jsonb_build_object(
    'contacts_linked_by_domain', step1_domain,
    'contacts_odoo_inherited', step2_odoo_inherit,
    'companies_linked_to_entities', step5_entity_companies,
    'contacts_linked_by_odoo_partner', step4_odoo_to_company,
    'contacts_linked_to_entities', step6_entity_contacts,
    'company_domains_filled', step7_domains,
    'emails_linked_to_companies', step8_emails_to_company,
    'total_resolved', step1_domain + step2_odoo_inherit + step5_entity_companies
      + step4_odoo_to_company + step6_entity_contacts + step7_domains + step8_emails_to_company,
    'resolved_at', now()
  );
END;
$function$;

-- ── Company enrichment RPC ─────────────────────────────────────────────
-- See src/app/api/pipeline/enrich-companies/ — fills domain/rfc/entity_id
-- from contacts, CFDIs, and odoo data. Batched 500 companies per run.
-- (Full function body in original migration applied via MCP)

-- ── Follow-up verification RPC ─────────────────────────────────────────
-- See src/app/api/pipeline/verify-follow-ups/ — compares snapshot at action
-- time with current company_narrative to determine if metric improved.
-- (Full function body in original migration applied via MCP)

-- ── follow_up_roi view ─────────────────────────────────────────────────
CREATE OR REPLACE VIEW follow_up_roi AS
SELECT
  category,
  count(*) as total,
  count(*) filter (where status = 'improved') as improved,
  count(*) filter (where status = 'unchanged') as unchanged,
  count(*) filter (where status = 'worsened') as worsened,
  count(*) filter (where status = 'pending') as pending,
  count(*) filter (where status = 'expired') as expired,
  CASE WHEN count(*) filter (where status IN ('improved','unchanged','worsened')) > 0
    THEN round(
      (count(*) filter (where status = 'improved')::numeric
       / count(*) filter (where status IN ('improved','unchanged','worsened'))) * 100, 1)
    ELSE NULL END as improvement_rate_pct
FROM insight_follow_ups
GROUP BY category
ORDER BY total DESC;

GRANT SELECT ON follow_up_roi TO anon, authenticated;

COMMENT ON VIEW follow_up_roi IS
  'Return-on-investment view: percentage of acted-on insights that improved the business metric.';
