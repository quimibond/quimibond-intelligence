-- ============================================================
-- Migration 025: Utility Improvements
-- ============================================================
-- Phase 1: Identity Resolution
--   - resolve_all_identities() RPC
--   - Auto-resolve trigger on contacts INSERT/UPDATE
--   - Domain extraction for companies
-- Phase 2: Alerts with business context
--   - business_value_at_risk, urgency_score columns
-- Phase 3: Role-based briefings
--   - Expanded scope CHECK for briefings
-- Phase 4: Feedback loop
--   - Auto-feedback trigger on alert state changes
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- PHASE 1: IDENTITY RESOLUTION
-- ════════════════════════════════════════════════════════════

-- Enable pg_trgm for fuzzy matching if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION resolve_all_identities()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  contacts_to_entities_email int := 0;
  contacts_to_entities_name int := 0;
  companies_to_entities int := 0;
  companies_domain_filled int := 0;
  contacts_to_companies int := 0;
  contacts_role_from_entity int := 0;
BEGIN
  -- Step 1: contacts → entities by exact email match
  UPDATE contacts c
  SET entity_id = e.id, updated_at = now()
  FROM entities e
  WHERE c.entity_id IS NULL
    AND e.entity_type = 'person'
    AND e.email IS NOT NULL
    AND lower(c.email) = lower(e.email);
  GET DIAGNOSTICS contacts_to_entities_email = ROW_COUNT;

  -- Step 2: contacts → entities by canonical_name match
  UPDATE contacts c
  SET entity_id = e.id, updated_at = now()
  FROM entities e
  WHERE c.entity_id IS NULL
    AND c.name IS NOT NULL
    AND e.entity_type = 'person'
    AND lower(trim(c.name)) = e.canonical_name;
  GET DIAGNOSTICS contacts_to_entities_name = ROW_COUNT;

  -- Step 3: companies → entities by canonical_name match
  UPDATE companies co
  SET entity_id = e.id, updated_at = now()
  FROM entities e
  WHERE co.entity_id IS NULL
    AND e.entity_type = 'company'
    AND co.canonical_name = e.canonical_name;
  GET DIAGNOSTICS companies_to_entities = ROW_COUNT;

  -- Step 4: Extract domain for companies from their contacts' emails
  -- Skip common free email providers
  UPDATE companies co
  SET domain = sub.extracted_domain, updated_at = now()
  FROM (
    SELECT DISTINCT ON (c.company_id)
      c.company_id,
      split_part(c.email, '@', 2) AS extracted_domain
    FROM contacts c
    WHERE c.company_id IS NOT NULL
      AND c.email IS NOT NULL
      AND c.email LIKE '%@%'
      AND split_part(c.email, '@', 2) NOT IN (
        'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com',
        'yahoo.com.mx', 'live.com', 'live.com.mx', 'icloud.com',
        'protonmail.com', 'aol.com', 'msn.com', 'hotmail.es',
        'outlook.es', 'mail.com', 'gmx.com'
      )
    ORDER BY c.company_id, c.interaction_count DESC NULLS LAST
  ) sub
  WHERE co.id = sub.company_id
    AND (co.domain IS NULL OR co.domain = '');
  GET DIAGNOSTICS companies_domain_filled = ROW_COUNT;

  -- Step 5: contacts → companies by email domain
  -- If contact has no company_id, match by email domain to company.domain
  UPDATE contacts c
  SET company_id = co.id, updated_at = now()
  FROM companies co
  WHERE c.company_id IS NULL
    AND c.email IS NOT NULL
    AND c.email LIKE '%@%'
    AND co.domain IS NOT NULL
    AND co.domain != ''
    AND split_part(c.email, '@', 2) = co.domain;
  GET DIAGNOSTICS contacts_to_companies = ROW_COUNT;

  -- Step 6: Copy role from entity attributes to contact if missing
  UPDATE contacts c
  SET role = e.attributes->>'role', updated_at = now()
  FROM entities e
  WHERE c.entity_id = e.id
    AND (c.role IS NULL OR c.role = '')
    AND e.attributes->>'role' IS NOT NULL
    AND e.attributes->>'role' != '';
  GET DIAGNOSTICS contacts_role_from_entity = ROW_COUNT;

  RETURN jsonb_build_object(
    'contacts_to_entities_email', contacts_to_entities_email,
    'contacts_to_entities_name', contacts_to_entities_name,
    'companies_to_entities', companies_to_entities,
    'companies_domain_filled', companies_domain_filled,
    'contacts_to_companies', contacts_to_companies,
    'contacts_role_from_entity', contacts_role_from_entity
  );
END;
$$;

-- Auto-resolve trigger function for contacts
CREATE OR REPLACE FUNCTION fn_auto_resolve_contact_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Try to link entity_id by email
  IF NEW.entity_id IS NULL AND NEW.email IS NOT NULL THEN
    SELECT id INTO NEW.entity_id
    FROM entities
    WHERE entity_type = 'person'
      AND lower(email) = lower(NEW.email)
    LIMIT 1;
  END IF;

  -- Try to link entity_id by name
  IF NEW.entity_id IS NULL AND NEW.name IS NOT NULL THEN
    SELECT id INTO NEW.entity_id
    FROM entities
    WHERE entity_type = 'person'
      AND canonical_name = lower(trim(NEW.name))
    LIMIT 1;
  END IF;

  -- Try to link company_id by email domain
  IF NEW.company_id IS NULL AND NEW.email IS NOT NULL AND NEW.email LIKE '%@%' THEN
    SELECT id INTO NEW.company_id
    FROM companies
    WHERE domain IS NOT NULL
      AND domain != ''
      AND domain = split_part(NEW.email, '@', 2)
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if any, then create
DROP TRIGGER IF EXISTS trg_auto_resolve_contact_identity ON contacts;
CREATE TRIGGER trg_auto_resolve_contact_identity
  BEFORE INSERT OR UPDATE ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION fn_auto_resolve_contact_identity();

-- Add domain column to companies if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'companies' AND column_name = 'domain'
  ) THEN
    ALTER TABLE companies ADD COLUMN domain text;
    CREATE INDEX idx_companies_domain ON companies(domain) WHERE domain IS NOT NULL;
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════
-- PHASE 2: ALERTS WITH BUSINESS CONTEXT
-- ════════════════════════════════════════════════════════════

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS business_value_at_risk numeric;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS urgency_score numeric;

-- Index for sorting alerts by urgency
CREATE INDEX IF NOT EXISTS idx_alerts_urgency
  ON alerts(urgency_score DESC NULLS LAST)
  WHERE state != 'resolved';

-- ════════════════════════════════════════════════════════════
-- PHASE 3: ROLE-BASED BRIEFINGS
-- ════════════════════════════════════════════════════════════

-- Drop old constraint and add expanded one
ALTER TABLE briefings DROP CONSTRAINT IF EXISTS briefings_scope_check;

DO $$
BEGIN
  ALTER TABLE briefings ADD CONSTRAINT briefings_scope_check
    CHECK (scope IN ('daily', 'account', 'company', 'weekly',
                     'director', 'ventas', 'logistica', 'compras'));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- ════════════════════════════════════════════════════════════
-- PHASE 4: FEEDBACK LOOP
-- ════════════════════════════════════════════════════════════

-- Auto-feedback when alert state changes to resolved
CREATE OR REPLACE FUNCTION fn_alert_feedback()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  hours_to_resolve numeric;
  signal text;
  score numeric;
BEGIN
  IF NEW.state = 'resolved' AND (OLD.state IS NULL OR OLD.state != 'resolved') THEN
    -- Calculate time to resolve
    hours_to_resolve := EXTRACT(EPOCH FROM (now() - OLD.created_at)) / 3600.0;
    NEW.resolved_at := now();
    NEW.time_to_resolve_hours := round(hours_to_resolve, 1);

    -- Determine feedback signal
    IF hours_to_resolve < 4 THEN
      signal := 'positive_fast';
      score := 1.0;
    ELSIF hours_to_resolve < 24 THEN
      signal := 'positive';
      score := 0.8;
    ELSIF hours_to_resolve < 72 THEN
      signal := 'neutral';
      score := 0.5;
    ELSE
      signal := 'slow_resolution';
      score := 0.2;
    END IF;

    -- Insert feedback signal
    INSERT INTO feedback_signals (
      source_type, source_id, signal_type,
      reward_score, context
    ) VALUES (
      'alert', NEW.id::text, signal,
      score,
      jsonb_build_object(
        'alert_type', NEW.alert_type,
        'severity', NEW.severity,
        'hours_to_resolve', round(hours_to_resolve, 1),
        'had_business_value', NEW.business_value_at_risk IS NOT NULL
      )
    );
  END IF;

  -- Auto-feedback for ignored alerts (acknowledged but not resolved after 48h)
  IF NEW.state = 'acknowledged' AND (OLD.state IS NULL OR OLD.state = 'new') THEN
    -- Track acknowledgment time for later analysis
    NEW.updated_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_alert_feedback ON alerts;
CREATE TRIGGER trg_alert_feedback
  BEFORE UPDATE ON alerts
  FOR EACH ROW
  WHEN (NEW.state IS DISTINCT FROM OLD.state)
  EXECUTE FUNCTION fn_alert_feedback();

-- ════════════════════════════════════════════════════════════
-- RUN IDENTITY RESOLUTION
-- ════════════════════════════════════════════════════════════

SELECT resolve_all_identities();
