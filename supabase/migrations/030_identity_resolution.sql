-- Migration 030: Identity Resolution
-- Resolves the gap where external contacts have no company_id link
-- and companies are disconnected from the knowledge graph (entity_id).
-- Uses pg_trgm (enabled in earlier migrations) for fuzzy name matching.
-- Matches LIVE schema: contacts has email, company_id, odoo_partner_id, entity_id
-- (NO commercial_partner_id, NO company text field)

-- ============================================================================
-- Function: get_identity_gaps()
-- Returns current gap statistics for identity resolution.
-- ============================================================================
CREATE OR REPLACE FUNCTION get_identity_gaps()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  total_contacts int;
  contacts_no_company int;
  contacts_no_odoo int;
  contacts_no_entity int;
  total_companies int;
  companies_no_odoo int;
  companies_no_entity int;
  companies_no_domain int;
  emails_no_company int;
  invoices_no_company int;
BEGIN
  SELECT count(*) INTO total_contacts FROM contacts;
  SELECT count(*) INTO contacts_no_company FROM contacts WHERE company_id IS NULL;
  SELECT count(*) INTO contacts_no_odoo FROM contacts WHERE odoo_partner_id IS NULL;
  SELECT count(*) INTO contacts_no_entity FROM contacts WHERE entity_id IS NULL;
  SELECT count(*) INTO total_companies FROM companies;
  SELECT count(*) INTO companies_no_odoo FROM companies WHERE odoo_partner_id IS NULL;
  SELECT count(*) INTO companies_no_entity FROM companies WHERE entity_id IS NULL;
  SELECT count(*) INTO companies_no_domain FROM companies WHERE domain IS NULL OR domain = '';
  SELECT count(*) INTO emails_no_company FROM emails WHERE company_id IS NULL;
  SELECT count(*) INTO invoices_no_company FROM odoo_invoices WHERE company_id IS NULL;

  RETURN jsonb_build_object(
    'total_contacts', total_contacts,
    'contacts_without_company', contacts_no_company,
    'contacts_without_odoo_partner', contacts_no_odoo,
    'contacts_without_entity', contacts_no_entity,
    'total_companies', total_companies,
    'companies_without_odoo_partner', companies_no_odoo,
    'companies_without_entity', companies_no_entity,
    'companies_without_domain', companies_no_domain,
    'emails_without_company', emails_no_company,
    'invoices_without_company', invoices_no_company,
    'contact_company_pct', CASE WHEN total_contacts > 0
      THEN round((1.0 - contacts_no_company::numeric / total_contacts) * 100, 1) ELSE 0 END,
    'contact_odoo_pct', CASE WHEN total_contacts > 0
      THEN round((1.0 - contacts_no_odoo::numeric / total_contacts) * 100, 1) ELSE 0 END,
    'company_entity_pct', CASE WHEN total_companies > 0
      THEN round((1.0 - companies_no_entity::numeric / total_companies) * 100, 1) ELSE 0 END,
    'measured_at', now()
  );
END;
$$;

-- ============================================================================
-- Function: resolve_identities()
-- Intelligent multi-step identity resolution. Idempotent — safe to run repeatedly.
-- Matches LIVE contacts schema (no commercial_partner_id, no company text).
-- ============================================================================
CREATE OR REPLACE FUNCTION resolve_identities()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  step1_domain int := 0;
  step2_odoo_inherit int := 0;
  step3_fuzzy_companies int := 0;
  step4_odoo_to_company int := 0;
  step5_entity_companies int := 0;
  step6_entity_contacts int := 0;
  step7_domains int := 0;
  step8_emails_to_company int := 0;
BEGIN
  -- ========================================================================
  -- Step 1: Link contacts to companies by email domain
  -- juan@textilesnorte.com → company where domain = 'textilesnorte.com'
  -- ========================================================================
  UPDATE contacts c
  SET company_id = co.id, updated_at = now()
  FROM companies co
  WHERE c.company_id IS NULL
    AND c.email IS NOT NULL
    AND c.email LIKE '%@%'
    AND co.domain IS NOT NULL
    AND co.domain != ''
    AND split_part(c.email, '@', 2) = co.domain;
  GET DIAGNOSTICS step1_domain = ROW_COUNT;

  -- ========================================================================
  -- Step 2: Inherit odoo_partner_id from company
  -- If contact has company_id and company has odoo_partner_id, inherit it
  -- ========================================================================
  UPDATE contacts c
  SET odoo_partner_id = co.odoo_partner_id, updated_at = now()
  FROM companies co
  WHERE c.odoo_partner_id IS NULL
    AND c.company_id IS NOT NULL
    AND c.company_id = co.id
    AND co.odoo_partner_id IS NOT NULL;
  GET DIAGNOSTICS step2_odoo_inherit = ROW_COUNT;

  -- ========================================================================
  -- Step 3: Link companies to entities by canonical_name fuzzy match
  -- 903 companies have no entity_id — try to match by name
  -- ========================================================================
  UPDATE companies co
  SET entity_id = sub.entity_id, updated_at = now()
  FROM (
    SELECT DISTINCT ON (co2.id)
      co2.id AS company_id,
      e.id AS entity_id
    FROM companies co2
    JOIN entities e
      ON e.entity_type = 'company'
      AND e.canonical_name IS NOT NULL
      AND co2.canonical_name IS NOT NULL
      AND similarity(co2.canonical_name, e.canonical_name) >= 0.6
    WHERE co2.entity_id IS NULL
    ORDER BY co2.id, similarity(co2.canonical_name, e.canonical_name) DESC
  ) sub
  WHERE co.id = sub.company_id;
  GET DIAGNOSTICS step5_entity_companies = ROW_COUNT;

  -- Also try exact match on odoo_id
  UPDATE companies co
  SET entity_id = e.id, updated_at = now()
  FROM entities e
  WHERE co.entity_id IS NULL
    AND e.entity_type = 'company'
    AND e.odoo_id IS NOT NULL
    AND co.odoo_partner_id IS NOT NULL
    AND e.odoo_id = co.odoo_partner_id;

  step5_entity_companies := step5_entity_companies + (
    SELECT count(*) FROM companies WHERE entity_id IS NOT NULL
      AND updated_at >= now() - interval '10 seconds'
  );

  -- ========================================================================
  -- Step 4: Link contacts to companies by odoo_partner_id match
  -- If contact has odoo_partner_id, find company with same odoo_partner_id
  -- ========================================================================
  UPDATE contacts c
  SET company_id = co.id, updated_at = now()
  FROM companies co
  WHERE c.company_id IS NULL
    AND c.odoo_partner_id IS NOT NULL
    AND co.odoo_partner_id = c.odoo_partner_id;
  GET DIAGNOSTICS step4_odoo_to_company = ROW_COUNT;

  -- ========================================================================
  -- Step 5: Link contacts to entities by email match
  -- ========================================================================
  UPDATE contacts c
  SET entity_id = e.id, updated_at = now()
  FROM entities e
  WHERE c.entity_id IS NULL
    AND c.email IS NOT NULL
    AND e.entity_type = 'person'
    AND e.email IS NOT NULL
    AND lower(c.email) = lower(e.email);
  GET DIAGNOSTICS step6_entity_contacts = ROW_COUNT;

  -- ========================================================================
  -- Step 6: Fill company domains from contact emails where missing
  -- ========================================================================
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
        'live.com', 'icloud.com', 'protonmail.com', 'aol.com',
        'googlemail.com', 'msn.com', 'mail.com', 'ymail.com',
        'hotmail.es', 'outlook.es', 'yahoo.com.mx'
      )
    ORDER BY c.company_id, c.updated_at DESC NULLS LAST
  ) sub
  WHERE co.id = sub.company_id
    AND (co.domain IS NULL OR co.domain = '');
  GET DIAGNOSTICS step7_domains = ROW_COUNT;

  -- ========================================================================
  -- Step 7: Link emails to companies via sender contact
  -- ========================================================================
  UPDATE emails em
  SET company_id = c.company_id
  FROM contacts c
  WHERE em.company_id IS NULL
    AND em.sender_contact_id IS NOT NULL
    AND em.sender_contact_id = c.id
    AND c.company_id IS NOT NULL;
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
$$;

-- ============================================================================
-- Missing indexes detected in live DB audit
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_pipeline_logs_phase_created ON pipeline_logs(phase, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_items_state_due ON action_items(state, due_date) WHERE state IN ('pending', 'in_progress');
CREATE INDEX IF NOT EXISTS idx_companies_entity_null ON companies(id) WHERE entity_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_company_null ON contacts(id) WHERE company_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_emails_company_null ON emails(id) WHERE company_id IS NULL AND sender_contact_id IS NOT NULL;

-- ============================================================================
-- Trigger: normalize insight categories to 8 fixed values on insert/update
-- ============================================================================
CREATE OR REPLACE FUNCTION normalize_insight_category()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  valid_cats text[] := ARRAY['cobranza','ventas','entregas','operaciones','proveedores','riesgo','equipo','datos'];
  cat text;
BEGIN
  cat := lower(coalesce(NEW.category, 'operaciones'));
  IF cat IN ('payment','cash_flow','finance','financiero') THEN NEW.category := 'cobranza';
  ELSIF cat IN ('sales','crm','churn') THEN NEW.category := 'ventas';
  ELSIF cat IN ('delivery','logistics') THEN NEW.category := 'entregas';
  ELSIF cat IN ('operations','inventory','manufacturing','quality') THEN NEW.category := 'operaciones';
  ELSIF cat IN ('procurement','supplier_concentration','supply_chain','compras') THEN NEW.category := 'proveedores';
  ELSIF cat IN ('risk','escalation') THEN NEW.category := 'riesgo';
  ELSIF cat IN ('team_performance','communication','hr') THEN NEW.category := 'equipo';
  ELSIF cat IN ('data_quality','data_completeness','agent_calibration','process_improvement','efficiency','meta') THEN NEW.category := 'datos';
  ELSIF NOT (cat = ANY(valid_cats)) THEN NEW.category := 'operaciones';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_insight_category ON agent_insights;
CREATE TRIGGER trg_normalize_insight_category
  BEFORE INSERT OR UPDATE OF category ON agent_insights
  FOR EACH ROW EXECUTE FUNCTION normalize_insight_category();
