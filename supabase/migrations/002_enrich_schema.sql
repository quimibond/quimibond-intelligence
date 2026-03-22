-- ============================================================
-- Migration 002: Enrich schema for actionable intelligence
--
-- Applied to the REAL Supabase schema (bigint PKs, existing
-- columns). Only adds what's missing.
-- ============================================================

-- ── 1. Alerts: add business context columns ─────────────────
-- already has: related_thread_id, related_contact, alert_date
-- missing: business_impact, suggested_action, contact_id (for FK joins)
ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS business_impact  text,
  ADD COLUMN IF NOT EXISTS suggested_action text;

-- ── 2. Action items: add reason + contact_company ───────────
-- already has: assignee_name, assignee_email, source_email_id
-- missing: reason (WHY), contact_company, source_thread_id
ALTER TABLE action_items
  ADD COLUMN IF NOT EXISTS reason           text,
  ADD COLUMN IF NOT EXISTS contact_company  text,
  ADD COLUMN IF NOT EXISTS source_thread_id text;

-- ── 3. Daily summaries: add key_events + account ────────────
-- already has: summary_date, summary_html, summary_text, total_emails
-- missing: key_events jsonb, account
ALTER TABLE daily_summaries
  ADD COLUMN IF NOT EXISTS key_events jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS account    text;

-- ── 4. Contacts: add sentiment_score if missing ─────────────
-- (already exists in real schema, this is just a safety check)

-- ── 5. RPC: Director dashboard ──────────────────────────────
CREATE OR REPLACE FUNCTION get_director_dashboard()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE result json;
BEGIN
  SELECT json_build_object(
    'kpi', json_build_object(
      'open_alerts', (SELECT count(*) FROM alerts WHERE state = 'new'),
      'critical_alerts', (SELECT count(*) FROM alerts WHERE state = 'new' AND severity IN ('critical','high')),
      'pending_actions', (SELECT count(*) FROM action_items WHERE state = 'pending'),
      'overdue_actions', (SELECT count(*) FROM action_items WHERE state = 'pending' AND due_date < CURRENT_DATE),
      'at_risk_contacts', (SELECT count(*) FROM contacts WHERE risk_level = 'high'),
      'total_contacts', (SELECT count(*) FROM contacts WHERE contact_type = 'external'),
      'total_emails', (SELECT count(*) FROM emails),
      'completed_actions', (SELECT count(*) FROM action_items WHERE state = 'completed'),
      'resolved_alerts', (SELECT count(*) FROM alerts WHERE state = 'resolved')
    ),
    'overdue_actions', (
      SELECT coalesce(json_agg(row_to_json(a)), '[]'::json)
      FROM (
        SELECT ai.id, ai.description, ai.contact_name, ai.contact_company,
               ai.assignee_email, ai.assignee_name, ai.due_date, ai.priority,
               ai.reason, ai.action_type,
               (CURRENT_DATE - ai.due_date) AS days_overdue
        FROM action_items ai
        WHERE ai.state = 'pending' AND ai.due_date < CURRENT_DATE
        ORDER BY ai.due_date ASC LIMIT 10
      ) a
    ),
    'critical_alerts', (
      SELECT coalesce(json_agg(row_to_json(al)), '[]'::json)
      FROM (
        SELECT al.id, al.title, al.severity, al.contact_name,
               al.description, al.business_impact, al.suggested_action,
               al.related_thread_id, al.created_at, al.alert_type, al.account
        FROM alerts al
        WHERE al.state = 'new' AND al.severity IN ('critical','high')
        ORDER BY
          CASE al.severity WHEN 'critical' THEN 0 ELSE 1 END,
          al.created_at DESC
        LIMIT 8
      ) al
    ),
    'accountability', (
      SELECT coalesce(json_agg(row_to_json(acc)), '[]'::json)
      FROM (
        SELECT
          coalesce(assignee_name, assignee_email, 'Sin asignar') AS name,
          assignee_email AS email,
          count(*) FILTER (WHERE state = 'pending') AS pending,
          count(*) FILTER (WHERE state = 'pending' AND due_date < CURRENT_DATE) AS overdue,
          count(*) FILTER (WHERE state = 'completed') AS completed
        FROM action_items
        WHERE assignee_email IS NOT NULL
        GROUP BY assignee_email, assignee_name
        HAVING count(*) FILTER (WHERE state = 'pending') > 0
        ORDER BY count(*) FILTER (WHERE state = 'pending' AND due_date < CURRENT_DATE) DESC
      ) acc
    ),
    'contacts_at_risk', (
      SELECT coalesce(json_agg(row_to_json(c)), '[]'::json)
      FROM (
        SELECT c.id, c.name, c.company, c.risk_level, c.sentiment_score,
               c.relationship_score, c.last_activity,
               c.score_breakdown,
               (SELECT count(*) FROM alerts al WHERE al.contact_name = c.name AND al.state = 'new') AS open_alerts,
               (SELECT count(*) FROM action_items ai WHERE ai.contact_name = c.name AND ai.state = 'pending') AS pending_actions
        FROM contacts c
        WHERE c.risk_level = 'high' AND c.contact_type = 'external'
        ORDER BY c.relationship_score ASC NULLS FIRST LIMIT 8
      ) c
    ),
    'latest_briefing', (
      SELECT row_to_json(b)
      FROM (
        SELECT id, briefing_type, summary, html_content, created_at
        FROM briefings ORDER BY created_at DESC LIMIT 1
      ) b
    ),
    'pending_actions', (
      SELECT coalesce(json_agg(row_to_json(pa)), '[]'::json)
      FROM (
        SELECT ai.id, ai.description, ai.contact_name, ai.contact_company,
               ai.assignee_email, ai.assignee_name, ai.due_date, ai.priority,
               ai.reason, ai.action_type, ai.state
        FROM action_items ai
        WHERE ai.state = 'pending'
        ORDER BY ai.due_date ASC NULLS LAST LIMIT 10
      ) pa
    )
  ) INTO result;
  RETURN result;
END;
$$;

-- ── 6. RPC: Alert with context ──────────────────────────────
CREATE OR REPLACE FUNCTION get_alert_with_context(p_alert_id bigint)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  result json;
  v_thread_id text;
  v_contact_name text;
BEGIN
  SELECT related_thread_id, contact_name
  INTO v_thread_id, v_contact_name
  FROM alerts WHERE id = p_alert_id;

  SELECT json_build_object(
    'alert', row_to_json(al),
    'thread_emails', (
      SELECT coalesce(json_agg(row_to_json(te)), '[]'::json)
      FROM (
        SELECT id, sender, recipient, subject, snippet, email_date, sender_type
        FROM emails WHERE gmail_thread_id = v_thread_id
        ORDER BY email_date DESC LIMIT 5
      ) te
    ),
    'related_actions', (
      SELECT coalesce(json_agg(row_to_json(ai)), '[]'::json)
      FROM (
        SELECT id, description, priority, state, assignee_email, assignee_name,
               due_date, reason, action_type
        FROM action_items
        WHERE contact_name = v_contact_name
        ORDER BY created_at DESC LIMIT 5
      ) ai
    ),
    'contact_facts', (
      SELECT coalesce(json_agg(row_to_json(f)), '[]'::json)
      FROM (
        SELECT f.fact_text, f.fact_type, f.confidence, f.created_at
        FROM facts f
        JOIN entities e ON e.id = f.entity_id
        WHERE e.name ILIKE '%' || v_contact_name || '%'
           OR e.canonical_name ILIKE '%' || v_contact_name || '%'
        ORDER BY f.created_at DESC LIMIT 5
      ) f
    )
  ) INTO result
  FROM alerts al WHERE al.id = p_alert_id;
  RETURN result;
END;
$$;

-- ── 7. RPC: Contact intelligence ────────────────────────────
CREATE OR REPLACE FUNCTION get_contact_intelligence(p_contact_email text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  result json;
  v_name text;
BEGIN
  SELECT name INTO v_name FROM contacts WHERE email = p_contact_email;

  SELECT json_build_object(
    'open_alerts', (SELECT count(*) FROM alerts WHERE contact_name = v_name AND state = 'new'),
    'pending_actions', (SELECT count(*) FROM action_items WHERE contact_name = v_name AND state = 'pending'),
    'overdue_actions', (SELECT count(*) FROM action_items WHERE contact_name = v_name AND state = 'pending' AND due_date < CURRENT_DATE),
    'recent_emails', (
      SELECT coalesce(json_agg(row_to_json(e)), '[]'::json)
      FROM (
        SELECT id, subject, snippet, sender, recipient, email_date, sender_type
        FROM emails
        WHERE sender ILIKE '%' || p_contact_email || '%'
           OR recipient ILIKE '%' || p_contact_email || '%'
        ORDER BY email_date DESC LIMIT 10
      ) e
    ),
    'person_profile', (
      SELECT row_to_json(pp)
      FROM (
        SELECT name, email, company, role, department, decision_power,
               communication_style, negotiation_style, response_pattern,
               key_interests, personality_notes, influence_on_deals
        FROM person_profiles
        WHERE email = p_contact_email
        ORDER BY updated_at DESC NULLS LAST LIMIT 1
      ) pp
    )
  ) INTO result;
  RETURN result;
END;
$$;

-- ── 8. Grant execute to anon ────────────────────────────────
GRANT EXECUTE ON FUNCTION get_director_dashboard() TO anon;
GRANT EXECUTE ON FUNCTION get_alert_with_context(bigint) TO anon;
GRANT EXECUTE ON FUNCTION get_contact_intelligence(text) TO anon;
