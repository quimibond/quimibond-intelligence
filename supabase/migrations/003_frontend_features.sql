-- ============================================================
-- Migration 003: Frontend features - feedback, health scores, threads
-- ============================================================

-- ── 1. Alerts: add feedback columns ──────────────────────────
ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS user_feedback text CHECK (user_feedback IN ('useful', 'false_positive', null)),
  ADD COLUMN IF NOT EXISTS feedback_note text;

-- ── 2. Action items: add feedback columns ────────────────────
ALTER TABLE action_items
  ADD COLUMN IF NOT EXISTS user_feedback text CHECK (user_feedback IN ('useful', 'not_useful', null)),
  ADD COLUMN IF NOT EXISTS feedback_note text;

-- ── 3. Customer health scores (if not exists) ────────────────
CREATE TABLE IF NOT EXISTS customer_health_scores (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id          uuid REFERENCES contacts(id) ON DELETE CASCADE,
  contact_email       text,
  score_date          date,
  total_score         numeric(5,2),
  communication_score numeric(5,2),
  financial_score     numeric(5,2),
  sentiment_score     numeric(5,2),
  responsiveness_score numeric(5,2),
  engagement_score    numeric(5,2),
  trend               text CHECK (trend IN ('improving', 'stable', 'declining', 'critical')),
  risk_signals        jsonb DEFAULT '[]',
  opportunity_signals jsonb DEFAULT '[]',
  score_breakdown     jsonb DEFAULT '{}',
  created_at          timestamptz DEFAULT now(),
  UNIQUE (contact_email, score_date)
);

-- ── 4. Revenue metrics (if not exists) ───────────────────────
CREATE TABLE IF NOT EXISTS revenue_metrics (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,
  contact_email   text,
  company_id      uuid,
  period_start    date,
  period_end      date,
  period_type     text DEFAULT 'monthly',
  total_invoiced  numeric(12,2) DEFAULT 0,
  total_paid      numeric(12,2) DEFAULT 0,
  total_overdue   numeric(12,2) DEFAULT 0,
  order_count     integer DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  UNIQUE (contact_email, period_start, period_type)
);

-- ── 5. Events timeline (if not exists) ───────────────────────
CREATE TABLE IF NOT EXISTS events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  text NOT NULL,
  source      text,
  entity_type text,
  entity_id   uuid,
  entity_ref  text,
  payload     jsonb DEFAULT '{}',
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_created ON events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_entity ON events (entity_type, entity_id);

-- ── 6. RLS for new tables ────────────────────────────────────
ALTER TABLE customer_health_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_health_scores" ON customer_health_scores FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_revenue_metrics" ON revenue_metrics FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_events" ON events FOR SELECT TO anon USING (true);

-- ── 7. RPC: Global search across all data ────────────────────
CREATE OR REPLACE FUNCTION search_global(p_query text, p_limit int DEFAULT 20)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  result json;
  q text := '%' || lower(p_query) || '%';
BEGIN
  SELECT json_build_object(
    'contacts', (
      SELECT coalesce(json_agg(row_to_json(c)), '[]'::json)
      FROM (
        SELECT id, name, email, company, risk_level, sentiment_score, relationship_score
        FROM contacts
        WHERE lower(name) LIKE q OR lower(email) LIKE q OR lower(company) LIKE q
        ORDER BY name LIMIT p_limit
      ) c
    ),
    'entities', (
      SELECT coalesce(json_agg(row_to_json(e)), '[]'::json)
      FROM (
        SELECT id, entity_type, name, canonical_name, attributes, last_seen
        FROM entities
        WHERE lower(name) LIKE q OR lower(canonical_name) LIKE q
        ORDER BY last_seen DESC NULLS LAST LIMIT p_limit
      ) e
    ),
    'alerts', (
      SELECT coalesce(json_agg(row_to_json(a)), '[]'::json)
      FROM (
        SELECT id, title, severity, contact_name, state, alert_type, created_at
        FROM alerts
        WHERE lower(title) LIKE q OR lower(description) LIKE q OR lower(contact_name) LIKE q
        ORDER BY created_at DESC LIMIT p_limit
      ) a
    ),
    'facts', (
      SELECT coalesce(json_agg(row_to_json(f)), '[]'::json)
      FROM (
        SELECT id, fact_text, fact_type, confidence, created_at
        FROM facts
        WHERE lower(fact_text) LIKE q
        ORDER BY confidence DESC, created_at DESC LIMIT p_limit
      ) f
    ),
    'emails', (
      SELECT coalesce(json_agg(row_to_json(em)), '[]'::json)
      FROM (
        SELECT id, subject, sender, recipient, snippet, email_date
        FROM emails
        WHERE lower(subject) LIKE q OR lower(snippet) LIKE q OR lower(sender) LIKE q
        ORDER BY email_date DESC LIMIT p_limit
      ) em
    )
  ) INTO result;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION search_global(text, int) TO anon;

-- ── 8. RPC: Get health score history for contact ─────────────
CREATE OR REPLACE FUNCTION get_contact_health_history(p_contact_id uuid, p_days int DEFAULT 30)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  result json;
BEGIN
  SELECT coalesce(json_agg(row_to_json(h)), '[]'::json) INTO result
  FROM (
    SELECT score_date, total_score, communication_score, financial_score,
           sentiment_score, responsiveness_score, engagement_score, trend,
           risk_signals, opportunity_signals
    FROM customer_health_scores
    WHERE contact_id = p_contact_id
      AND score_date >= CURRENT_DATE - p_days
    ORDER BY score_date DESC
  ) h;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_contact_health_history(uuid, int) TO anon;

-- ── 9. RPC: Get company revenue history ──────────────────────
CREATE OR REPLACE FUNCTION get_company_revenue(p_company_name text, p_months int DEFAULT 12)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  result json;
BEGIN
  SELECT coalesce(json_agg(row_to_json(r)), '[]'::json) INTO result
  FROM (
    SELECT rm.period_start, rm.period_type,
           SUM(rm.total_invoiced) as total_invoiced,
           SUM(rm.total_paid) as total_paid,
           SUM(rm.total_overdue) as total_overdue,
           SUM(rm.order_count) as order_count
    FROM revenue_metrics rm
    JOIN contacts c ON c.id = rm.contact_id
    WHERE lower(c.company) LIKE '%' || lower(p_company_name) || '%'
      AND rm.period_start >= CURRENT_DATE - (p_months || ' months')::interval
    GROUP BY rm.period_start, rm.period_type
    ORDER BY rm.period_start DESC
  ) r;
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_company_revenue(text, int) TO anon;
