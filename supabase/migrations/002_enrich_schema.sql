-- ============================================================
-- Migration 002: Enrich schema for actionable intelligence
--
-- Fixes the gap between what the backend generates and what
-- the database stores. Adds traceability (alert→email→action),
-- accountability (assignee context), and RPC functions for
-- efficient frontend queries.
-- ============================================================

-- ── 1. Alerts: add source traceability + business context ────
ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS source_thread_id text,
  ADD COLUMN IF NOT EXISTS source_email_id  bigint,
  ADD COLUMN IF NOT EXISTS business_impact  text,
  ADD COLUMN IF NOT EXISTS suggested_action text;

CREATE INDEX IF NOT EXISTS idx_alerts_thread
  ON alerts (source_thread_id) WHERE source_thread_id IS NOT NULL;

-- ── 2. Action items: add WHO/WHY/SOURCE context ─────────────
ALTER TABLE action_items
  ADD COLUMN IF NOT EXISTS assignee_name    text,
  ADD COLUMN IF NOT EXISTS source_alert_id  uuid REFERENCES alerts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_thread_id text,
  ADD COLUMN IF NOT EXISTS source_email_id  bigint,
  ADD COLUMN IF NOT EXISTS reason           text,
  ADD COLUMN IF NOT EXISTS contact_company  text;

CREATE INDEX IF NOT EXISTS idx_actions_assignee
  ON action_items (assignee_email) WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS idx_actions_contact
  ON action_items (contact_id) WHERE contact_id IS NOT NULL;

-- ── 3. Response metrics: align with backend output ──────────
ALTER TABLE response_metrics
  ADD COLUMN IF NOT EXISTS metric_date          date,
  ADD COLUMN IF NOT EXISTS emails_received      integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS emails_sent          integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS internal_received    integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS external_received    integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS threads_started      integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS threads_replied      integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS threads_unanswered   integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_response_hours   numeric,
  ADD COLUMN IF NOT EXISTS fastest_response_hours numeric,
  ADD COLUMN IF NOT EXISTS slowest_response_hours numeric;

-- ── 4. Account summaries: align with backend output ─────────
ALTER TABLE account_summaries
  ADD COLUMN IF NOT EXISTS summary_date      date,
  ADD COLUMN IF NOT EXISTS department        text,
  ADD COLUMN IF NOT EXISTS external_emails   integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS internal_emails   integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS key_items         jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS waiting_response  jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS urgent_items      jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS external_contacts jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS topics_detected   jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS summary_text      text,
  ADD COLUMN IF NOT EXISTS overall_sentiment text,
  ADD COLUMN IF NOT EXISTS sentiment_detail  text,
  ADD COLUMN IF NOT EXISTS risks_detected    jsonb DEFAULT '[]';

-- ── 5. Daily summaries: ensure account column + unique ──────
-- (account may already exist; summary_date unique per account)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_daily_summaries_date_account'
  ) THEN
    BEGIN
      ALTER TABLE daily_summaries
        ADD CONSTRAINT uq_daily_summaries_date_account UNIQUE (summary_date, account);
    EXCEPTION WHEN others THEN
      NULL; -- ignore if already exists or can't add
    END;
  END IF;
END $$;

-- ── 6. RPC: Director dashboard (single call) ────────────────
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
      'total_contacts', (SELECT count(*) FROM contacts),
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
               CURRENT_DATE - ai.due_date AS days_overdue
        FROM action_items ai
        WHERE ai.state = 'pending' AND ai.due_date < CURRENT_DATE
        ORDER BY ai.due_date ASC LIMIT 10
      ) a
    ),
    'critical_alerts', (
      SELECT coalesce(json_agg(row_to_json(al)), '[]'::json)
      FROM (
        SELECT al.id, al.title, al.severity, al.contact_name, al.contact_id,
               al.description, al.business_impact, al.suggested_action,
               al.source_thread_id, al.created_at, al.alert_type
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
          coalesce(assignee_name, assignee_email) AS name,
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
               c.relationship_score, c.last_interaction,
               (SELECT count(*) FROM alerts WHERE contact_id = c.id AND state = 'new') AS open_alerts,
               (SELECT count(*) FROM action_items WHERE contact_id = c.id AND state = 'pending') AS pending_actions
        FROM contacts c
        WHERE c.risk_level = 'high'
        ORDER BY c.sentiment_score ASC NULLS FIRST LIMIT 8
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

-- ── 7. RPC: Alert with full context ─────────────────────────
CREATE OR REPLACE FUNCTION get_alert_with_context(p_alert_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE result json;
BEGIN
  SELECT json_build_object(
    'alert', row_to_json(al),
    'source_email', (
      SELECT row_to_json(e) FROM emails e WHERE e.id = al.source_email_id
    ),
    'thread_emails', (
      SELECT coalesce(json_agg(row_to_json(te)), '[]'::json)
      FROM (
        SELECT id, sender, recipient, subject, snippet, email_date, sender_type
        FROM emails WHERE gmail_thread_id = al.source_thread_id
        ORDER BY email_date DESC LIMIT 5
      ) te
    ),
    'related_actions', (
      SELECT coalesce(json_agg(row_to_json(ai)), '[]'::json)
      FROM (
        SELECT id, description, priority, state, assignee_email, assignee_name,
               due_date, reason, action_type
        FROM action_items
        WHERE source_alert_id = al.id
           OR (contact_id = al.contact_id AND contact_id IS NOT NULL)
        ORDER BY created_at DESC LIMIT 5
      ) ai
    ),
    'contact', (
      SELECT row_to_json(c) FROM contacts c WHERE c.id = al.contact_id
    ),
    'contact_facts', (
      SELECT coalesce(json_agg(row_to_json(f)), '[]'::json)
      FROM (
        SELECT fact_text, fact_type, confidence, created_at
        FROM facts WHERE contact_id = al.contact_id
        ORDER BY created_at DESC LIMIT 5
      ) f
    )
  ) INTO result
  FROM alerts al WHERE al.id = p_alert_id;
  RETURN result;
END;
$$;

-- ── 8. RPC: Contact timeline with relationship trend ────────
CREATE OR REPLACE FUNCTION get_contact_intelligence(p_contact_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  result json;
  contact_email text;
BEGIN
  SELECT email INTO contact_email FROM contacts WHERE id = p_contact_id;

  SELECT json_build_object(
    'open_alerts', (SELECT count(*) FROM alerts WHERE contact_id = p_contact_id AND state = 'new'),
    'pending_actions', (SELECT count(*) FROM action_items WHERE contact_id = p_contact_id AND state = 'pending'),
    'overdue_actions', (SELECT count(*) FROM action_items WHERE contact_id = p_contact_id AND state = 'pending' AND due_date < CURRENT_DATE),
    'total_facts', (SELECT count(*) FROM facts WHERE contact_id = p_contact_id),
    'recent_emails', (
      SELECT coalesce(json_agg(row_to_json(e)), '[]'::json)
      FROM (
        SELECT id, subject, snippet, sender, recipient, email_date, sender_type
        FROM emails
        WHERE sender ILIKE '%' || contact_email || '%'
           OR recipient ILIKE '%' || contact_email || '%'
        ORDER BY email_date DESC LIMIT 10
      ) e
    ),
    'related_entities', (
      SELECT coalesce(json_agg(row_to_json(re)), '[]'::json)
      FROM (
        SELECT e.name, e.entity_type, er.relationship_type, er.confidence
        FROM entity_relationships er
        JOIN entities e ON e.id = er.entity_b_id
        WHERE er.entity_a_id IN (
          SELECT id FROM entities WHERE email = contact_email
        )
        LIMIT 10
      ) re
    )
  ) INTO result;
  RETURN result;
END;
$$;

-- ── 9. Grant execute to anon for RPC functions ──────────────
GRANT EXECUTE ON FUNCTION get_director_dashboard() TO anon;
GRANT EXECUTE ON FUNCTION get_alert_with_context(uuid) TO anon;
GRANT EXECUTE ON FUNCTION get_contact_intelligence(uuid) TO anon;
