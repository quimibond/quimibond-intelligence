-- ============================================================================
-- Migration 026: Decision Engine Schema Alignment
--
-- Aligns Supabase schema with the new Decision Inbox, action workflow,
-- and realtime notification features.
-- ============================================================================

-- ─── 1. Link action_items → alerts (bidirectional traceability) ─────────

ALTER TABLE action_items
  ADD COLUMN IF NOT EXISTS alert_id bigint REFERENCES alerts(id) ON DELETE SET NULL;

COMMENT ON COLUMN action_items.alert_id IS
  'Source alert that generated this action (nullable for manually created actions)';

CREATE INDEX IF NOT EXISTS idx_action_items_alert_id
  ON action_items(alert_id) WHERE alert_id IS NOT NULL;


-- ─── 2. Expand action_items state machine ───────────────────────────────
-- Add "blocked", "escalated", "in_progress" states

ALTER TABLE action_items
  DROP CONSTRAINT IF EXISTS action_items_state_check;

ALTER TABLE action_items
  ADD CONSTRAINT action_items_state_check
    CHECK (state IN ('pending', 'in_progress', 'completed', 'dismissed', 'blocked', 'escalated'));


-- ─── 3. Allow frontend to INSERT action_items (create from alerts) ──────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'action_items' AND policyname = 'anon_insert_actions'
  ) THEN
    CREATE POLICY "anon_insert_actions" ON action_items
      FOR INSERT TO anon WITH CHECK (true);
  END IF;
END $$;


-- ─── 4. Enable RLS + read policy on odoo_users (AssigneeSelect) ────────

ALTER TABLE odoo_users ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'odoo_users' AND policyname = 'anon_read_odoo_users'
  ) THEN
    CREATE POLICY "anon_read_odoo_users" ON odoo_users
      FOR SELECT TO anon USING (true);
  END IF;
END $$;


-- ─── 5. Enable RLS + read on tables missing policies ───────────────────
-- These tables are written by qb19 backend, read by frontend

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'briefings', 'topics', 'health_scores', 'revenue_metrics',
    'communication_metrics', 'odoo_snapshots', 'odoo_products',
    'odoo_order_lines', 'odoo_invoices', 'odoo_payments',
    'odoo_deliveries', 'odoo_crm_leads', 'odoo_activities'
  ]) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = tbl AND policyname = 'anon_read_' || tbl
    ) THEN
      EXECUTE format(
        'CREATE POLICY "anon_read_%s" ON %I FOR SELECT TO anon USING (true)',
        tbl, tbl
      );
    END IF;
  END LOOP;
END $$;


-- ─── 6. Realtime support: INSERT policy on alerts ──────────────────────
-- Needed for Supabase Realtime to notify on new alerts

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'alerts' AND policyname = 'anon_insert_alerts'
  ) THEN
    CREATE POLICY "anon_insert_alerts" ON alerts
      FOR INSERT TO anon WITH CHECK (true);
  END IF;
END $$;


-- ─── 7. Performance indexes for Decision Inbox queries ─────────────────

-- Actions by assignee (for reassignment queries and accountability)
CREATE INDEX IF NOT EXISTS idx_action_items_assignee_state
  ON action_items(assignee_email, state, due_date)
  WHERE state IN ('pending', 'in_progress', 'blocked', 'escalated');

-- Actions by company (for company detail page)
CREATE INDEX IF NOT EXISTS idx_action_items_company_id
  ON action_items(company_id) WHERE company_id IS NOT NULL;

-- Alerts by company (for company detail page)
CREATE INDEX IF NOT EXISTS idx_alerts_company_id
  ON alerts(company_id) WHERE company_id IS NOT NULL;

-- Pipeline runs: latest completed (for DataFreshness component)
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_completed
  ON pipeline_runs(started_at DESC) WHERE status = 'completed';


-- ─── 8. RPC: Get actions linked to an alert ────────────────────────────

CREATE OR REPLACE FUNCTION get_alert_actions(p_alert_id bigint)
RETURNS SETOF action_items
LANGUAGE sql STABLE
AS $$
  SELECT * FROM action_items
  WHERE alert_id = p_alert_id
  ORDER BY created_at DESC;
$$;


-- ─── 9. RPC: Decision Inbox — top items ranked by impact ───────────────

CREATE OR REPLACE FUNCTION get_decision_inbox(p_limit int DEFAULT 30)
RETURNS TABLE (
  item_type text,
  id bigint,
  title text,
  description text,
  severity text,
  priority text,
  state text,
  business_value_at_risk numeric,
  urgency_score numeric,
  suggested_action text,
  contact_id bigint,
  contact_name text,
  company_id bigint,
  thread_id bigint,
  assignee_name text,
  assignee_email text,
  due_date date,
  created_at timestamptz
)
LANGUAGE sql STABLE
AS $$
  (
    SELECT
      'alert'::text AS item_type,
      a.id,
      a.title,
      a.description,
      a.severity,
      CASE WHEN a.severity IN ('critical','high') THEN 'high' ELSE 'medium' END AS priority,
      a.state,
      a.business_value_at_risk,
      a.urgency_score,
      a.suggested_action,
      a.contact_id,
      a.contact_name,
      a.company_id,
      a.thread_id,
      NULL::text AS assignee_name,
      NULL::text AS assignee_email,
      NULL::date AS due_date,
      a.created_at
    FROM alerts a
    WHERE a.state IN ('new', 'acknowledged')
  )
  UNION ALL
  (
    SELECT
      'action'::text AS item_type,
      ai.id,
      ai.description AS title,
      ai.reason AS description,
      CASE WHEN ai.due_date < CURRENT_DATE THEN 'high' ELSE 'medium' END AS severity,
      ai.priority,
      ai.state,
      NULL::numeric AS business_value_at_risk,
      NULL::numeric AS urgency_score,
      NULL::text AS suggested_action,
      ai.contact_id,
      ai.contact_name,
      ai.company_id,
      ai.thread_id,
      ai.assignee_name,
      ai.assignee_email,
      ai.due_date,
      ai.created_at
    FROM action_items ai
    WHERE ai.state = 'pending'
  )
  ORDER BY
    -- Composite impact score: severity weight + value + age
    CASE severity
      WHEN 'critical' THEN 100
      WHEN 'high' THEN 70
      WHEN 'medium' THEN 40
      ELSE 15
    END
    + COALESCE(LOG(GREATEST(business_value_at_risk, 1)) * 10, 0)
    + LEAST(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400 * 3, 30)
    DESC
  LIMIT p_limit;
$$;
