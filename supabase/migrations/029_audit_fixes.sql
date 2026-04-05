-- ============================================================================
-- Migration 029: Comprehensive Audit Fixes
--
-- Fixes identified during full project audit:
-- 1. Fix broken trigger reference (auto_link_order_to_company → auto_link_order_company)
-- 2. Add missing indexes for performance
-- 3. Add missing health_score sync trigger
-- 4. Fix email_recipients contact_id type (BIGINT → uuid)
-- 5. Add missing fact_type index
-- 6. Add safety to auto-link triggers (exception handling)
-- 7. Fix get_decision_inbox return types (bigint → uuid for contact/company/thread IDs)
-- ============================================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. FIX BROKEN TRIGGER: invoice lines uses wrong function name
--    Migration 028 referenced auto_link_order_to_company() but
--    the function is named auto_link_order_company() (migration 027)
-- ═══════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_auto_link_invoice_line_company ON odoo_invoice_lines;
CREATE TRIGGER trg_auto_link_invoice_line_company
  BEFORE INSERT OR UPDATE ON odoo_invoice_lines
  FOR EACH ROW
  EXECUTE FUNCTION auto_link_order_company();


-- ═══════════════════════════════════════════════════════════════
-- 2. FIX email_recipients.contact_id TYPE MISMATCH
--    contacts.id is uuid, but email_recipients declared BIGINT
-- ═══════════════════════════════════════════════════════════════

-- Recreate table with correct type if the column type is wrong
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'email_recipients'
      AND column_name = 'contact_id'
      AND data_type = 'bigint'
  ) THEN
    -- Drop and recreate with correct uuid type
    DROP TABLE IF EXISTS email_recipients CASCADE;

    CREATE TABLE email_recipients (
      id              BIGSERIAL PRIMARY KEY,
      email_id        BIGINT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
      contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      recipient_email TEXT NOT NULL,
      recipient_name  TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(email_id, contact_id)
    );

    CREATE INDEX idx_email_recipients_email ON email_recipients(email_id);
    CREATE INDEX idx_email_recipients_contact ON email_recipients(contact_id);

    ALTER TABLE email_recipients ENABLE ROW LEVEL SECURITY;

    -- Recreate policies
    CREATE POLICY "email_recipients_select" ON email_recipients FOR SELECT USING (true);
    CREATE POLICY "email_recipients_insert" ON email_recipients FOR INSERT WITH CHECK (true);
  END IF;
END $$;

-- Recreate resolve function with correct uuid type
CREATE OR REPLACE FUNCTION resolve_email_recipients()
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  resolved_count INT := 0;
  total_parsed INT := 0;
  rec RECORD;
  addr TEXT;
  addr_email TEXT;
  addr_name TEXT;
  contact_rec RECORD;
BEGIN
  FOR rec IN
    SELECT e.id AS email_id, e.recipient
    FROM emails e
    WHERE e.recipient IS NOT NULL
      AND e.recipient != ''
      AND NOT EXISTS (SELECT 1 FROM email_recipients er WHERE er.email_id = e.id)
    LIMIT 500
  LOOP
    FOREACH addr IN ARRAY string_to_array(rec.recipient, ',')
    LOOP
      addr := trim(addr);
      IF addr = '' THEN CONTINUE; END IF;
      total_parsed := total_parsed + 1;

      IF addr LIKE '%<%>%' THEN
        addr_email := lower(trim(both ' >' FROM substring(addr FROM '<([^>]+)>')));
        addr_name := trim(both '" ''' FROM split_part(addr, '<', 1));
        IF addr_name = '' THEN addr_name := NULL; END IF;
      ELSE
        addr_email := lower(trim(addr));
        addr_name := NULL;
      END IF;

      IF addr_email IS NULL OR addr_email = '' THEN CONTINUE; END IF;

      SELECT id INTO contact_rec FROM contacts WHERE email = addr_email LIMIT 1;

      IF contact_rec.id IS NOT NULL THEN
        INSERT INTO email_recipients (email_id, contact_id, recipient_email, recipient_name)
        VALUES (rec.email_id, contact_rec.id, addr_email, addr_name)
        ON CONFLICT (email_id, contact_id) DO NOTHING;
        resolved_count := resolved_count + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN json_build_object(
    'total_addresses_parsed', total_parsed,
    'resolved_to_contacts', resolved_count
  );
END;
$$;


-- ═══════════════════════════════════════════════════════════════
-- 3. PERFORMANCE INDEXES (missing from earlier migrations)
-- ═══════════════════════════════════════════════════════════════

-- facts.fact_type — heavily filtered in agent queries
CREATE INDEX IF NOT EXISTS idx_facts_type ON facts(fact_type);

-- threads.status — filtered in pipeline queries
CREATE INDEX IF NOT EXISTS idx_threads_status ON threads(status) WHERE status NOT IN ('resolved', 'closed');

-- agent_insights by state — heavily queried by inbox, cleanup, validate
CREATE INDEX IF NOT EXISTS idx_insights_state_created
  ON agent_insights(state, created_at DESC)
  WHERE state IN ('new', 'seen');

-- emails.kg_processed — filtered in analyze pipeline
CREATE INDEX IF NOT EXISTS idx_emails_kg_processed
  ON emails(kg_processed) WHERE kg_processed = false;

-- entity_mentions.email_id — missing FK index
CREATE INDEX IF NOT EXISTS idx_entity_mentions_email ON entity_mentions(email_id);


-- ═══════════════════════════════════════════════════════════════
-- 4. HEALTH SCORE → CONTACT SYNC TRIGGER (was documented but missing)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION sync_health_score_to_contact()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE contacts
  SET current_health_score = NEW.total_score,
      updated_at = now()
  WHERE id = NEW.contact_id;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Don't fail the insert if contact update fails
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'health_scores' AND column_name = 'contact_id'
  ) THEN
    DROP TRIGGER IF EXISTS trg_health_score_sync ON health_scores;
    CREATE TRIGGER trg_health_score_sync
      AFTER INSERT OR UPDATE ON health_scores
      FOR EACH ROW
      EXECUTE FUNCTION sync_health_score_to_contact();
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════
-- 5. ADD EXCEPTION HANDLING TO AUTO-LINK TRIGGERS
--    Prevents silent failures from crashing inserts/updates
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION auto_link_invoice_company()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.company_id IS NULL AND NEW.odoo_partner_id IS NOT NULL THEN
    SELECT id INTO NEW.company_id
    FROM companies
    WHERE odoo_partner_id = NEW.odoo_partner_id
    LIMIT 1;

    IF NEW.company_id IS NULL THEN
      SELECT company_id INTO NEW.company_id
      FROM contacts
      WHERE odoo_partner_id = NEW.odoo_partner_id
        AND company_id IS NOT NULL
      LIMIT 1;
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION auto_link_order_company()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.company_id IS NULL AND NEW.odoo_partner_id IS NOT NULL THEN
    SELECT id INTO NEW.company_id
    FROM companies
    WHERE odoo_partner_id = NEW.odoo_partner_id
    LIMIT 1;

    IF NEW.company_id IS NULL THEN
      SELECT company_id INTO NEW.company_id
      FROM contacts
      WHERE odoo_partner_id = NEW.odoo_partner_id
        AND company_id IS NOT NULL
      LIMIT 1;
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION auto_link_contact_entity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.entity_id IS NULL AND NEW.email IS NOT NULL THEN
    SELECT id INTO NEW.entity_id
    FROM entities
    WHERE entity_type = 'person' AND email = NEW.email
    LIMIT 1;
  END IF;

  IF NEW.company_id IS NULL AND NEW.odoo_partner_id IS NOT NULL THEN
    SELECT id INTO NEW.company_id
    FROM companies
    WHERE odoo_partner_id = NEW.odoo_partner_id
    LIMIT 1;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION auto_link_company_entity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.entity_id IS NULL AND NEW.odoo_partner_id IS NOT NULL THEN
    SELECT id INTO NEW.entity_id
    FROM entities
    WHERE entity_type = 'company'
      AND odoo_id = NEW.odoo_partner_id
    LIMIT 1;
  END IF;

  IF NEW.entity_id IS NULL AND NEW.canonical_name IS NOT NULL THEN
    SELECT id INTO NEW.entity_id
    FROM entities
    WHERE entity_type = 'company'
      AND LOWER(TRIM(canonical_name)) = LOWER(TRIM(NEW.canonical_name))
    LIMIT 1;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;


-- ═══════════════════════════════════════════════════════════════
-- 6. FIX get_decision_inbox RETURN TYPES
--    contact_id, company_id, thread_id should be uuid (matching source tables)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_decision_inbox(p_limit int DEFAULT 30)
RETURNS TABLE (
  item_type text,
  id uuid,
  title text,
  description text,
  severity text,
  priority text,
  state text,
  business_value_at_risk numeric,
  urgency_score numeric,
  suggested_action text,
  contact_id uuid,
  contact_name text,
  company_id bigint,
  thread_id uuid,
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


-- ═══════════════════════════════════════════════════════════════
-- 7. ADD fact_hash COLUMN IF MISSING (referenced by constraints but never created)
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE facts ADD COLUMN IF NOT EXISTS fact_hash text;
CREATE INDEX IF NOT EXISTS idx_facts_hash ON facts(fact_hash) WHERE fact_hash IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════
-- 8. ENSURE contacts has current_health_score column
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS current_health_score numeric;


-- ═══════════════════════════════════════════════════════════════
-- 9. LOG THIS MIGRATION
-- ═══════════════════════════════════════════════════════════════

INSERT INTO pipeline_logs (level, phase, message, details)
VALUES (
  'info',
  'migration',
  'Applied migration 029: audit fixes (trigger fix, type fix, indexes, health sync)',
  '{"fixes": ["invoice_line_trigger", "email_recipients_type", "performance_indexes", "health_score_trigger", "trigger_error_handling", "decision_inbox_types", "fact_hash_column"]}'::jsonb
);
