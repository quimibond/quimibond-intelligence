-- Migration 030: Identity Resolution
-- Resolves the gap where external contacts have no odoo_partner_id link
-- and companies extracted from emails are disconnected from Odoo companies.
-- Uses pg_trgm (enabled in migration 025) for fuzzy name matching.

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
  contacts_no_commercial int;
  total_companies int;
  companies_no_odoo int;
  companies_no_domain int;
BEGIN
  SELECT count(*) INTO total_contacts FROM contacts;

  SELECT count(*) INTO contacts_no_company
  FROM contacts WHERE company_id IS NULL;

  SELECT count(*) INTO contacts_no_odoo
  FROM contacts WHERE odoo_partner_id IS NULL;

  SELECT count(*) INTO contacts_no_commercial
  FROM contacts WHERE commercial_partner_id IS NULL;

  SELECT count(*) INTO total_companies FROM companies;

  SELECT count(*) INTO companies_no_odoo
  FROM companies WHERE odoo_partner_id IS NULL;

  SELECT count(*) INTO companies_no_domain
  FROM companies WHERE domain IS NULL OR domain = '';

  RETURN jsonb_build_object(
    'total_contacts', total_contacts,
    'contacts_without_company', contacts_no_company,
    'contacts_without_odoo_partner', contacts_no_odoo,
    'contacts_without_commercial_partner', contacts_no_commercial,
    'total_companies', total_companies,
    'companies_without_odoo_partner', companies_no_odoo,
    'companies_without_domain', companies_no_domain,
    'contact_company_pct', CASE WHEN total_contacts > 0
      THEN round((1.0 - contacts_no_company::numeric / total_contacts) * 100, 1)
      ELSE 0 END,
    'contact_odoo_pct', CASE WHEN total_contacts > 0
      THEN round((1.0 - contacts_no_odoo::numeric / total_contacts) * 100, 1)
      ELSE 0 END,
    'company_odoo_pct', CASE WHEN total_companies > 0
      THEN round((1.0 - companies_no_odoo::numeric / total_companies) * 100, 1)
      ELSE 0 END,
    'measured_at', now()
  );
END;
$$;

-- ============================================================================
-- Function: resolve_identities()
-- Intelligent multi-step identity resolution. Idempotent — safe to run repeatedly.
-- ============================================================================
CREATE OR REPLACE FUNCTION resolve_identities()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  step1_contacts_to_companies int := 0;
  step2_contacts_to_odoo int := 0;
  step3_companies_to_odoo int := 0;
  step4_contacts_via_odoo int := 0;
  step5_propagated int := 0;
  step6_domains_filled int := 0;
BEGIN
  -- ========================================================================
  -- Step 1: Link contacts to companies by email domain
  -- contacts.email domain → companies.domain (already extracted by qb19)
  -- Example: juan@textilesnorte.com → company where domain = 'textilesnorte.com'
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
  GET DIAGNOSTICS step1_contacts_to_companies = ROW_COUNT;

  -- ========================================================================
  -- Step 2: Link contacts to Odoo partners by email match
  -- Find contacts whose email appears as a sender in emails that are linked
  -- to companies which have odoo data (invoices/orders with odoo_partner_id).
  -- This gives us the odoo_partner_id for the contact's company.
  -- ========================================================================
  UPDATE contacts c
  SET odoo_partner_id = sub.odoo_partner_id, updated_at = now()
  FROM (
    -- Match contact email to Odoo contacts that have odoo_partner_id set
    SELECT DISTINCT ON (c2.id) c2.id AS contact_id, oc.odoo_partner_id
    FROM contacts c2
    JOIN contacts oc
      ON oc.email = c2.email
      AND oc.odoo_partner_id IS NOT NULL
    WHERE c2.odoo_partner_id IS NULL
      AND c2.email IS NOT NULL
  ) sub
  WHERE c.id = sub.contact_id;
  GET DIAGNOSTICS step2_contacts_to_odoo = ROW_COUNT;

  -- Also try: if contact has company_id and that company has odoo_partner_id
  UPDATE contacts c
  SET odoo_partner_id = co.odoo_partner_id, updated_at = now()
  FROM companies co
  WHERE c.odoo_partner_id IS NULL
    AND c.company_id IS NOT NULL
    AND c.company_id = co.id
    AND co.odoo_partner_id IS NOT NULL;

  step2_contacts_to_odoo := step2_contacts_to_odoo + (
    SELECT count(*) FROM contacts
    WHERE odoo_partner_id IS NOT NULL
      AND updated_at >= now() - interval '5 seconds'
      AND company_id IS NOT NULL
  ) - step2_contacts_to_odoo;

  -- ========================================================================
  -- Step 3: Link companies to Odoo by name fuzzy match
  -- companies.canonical_name vs other companies where odoo_partner_id is set
  -- Uses pg_trgm similarity() with threshold 0.6
  -- ========================================================================
  UPDATE companies target
  SET odoo_partner_id = sub.odoo_partner_id, updated_at = now()
  FROM (
    SELECT DISTINCT ON (t.id)
      t.id AS target_id,
      src.odoo_partner_id,
      similarity(t.canonical_name, src.canonical_name) AS sim
    FROM companies t
    JOIN companies src
      ON src.odoo_partner_id IS NOT NULL
      AND src.id != t.id
      AND t.canonical_name IS NOT NULL
      AND src.canonical_name IS NOT NULL
      AND similarity(t.canonical_name, src.canonical_name) >= 0.6
    WHERE t.odoo_partner_id IS NULL
    ORDER BY t.id, similarity(t.canonical_name, src.canonical_name) DESC
  ) sub
  WHERE target.id = sub.target_id;
  GET DIAGNOSTICS step3_companies_to_odoo = ROW_COUNT;

  -- Also try matching company canonical_name against contacts that have
  -- odoo_partner_id and a "company" field set (text name from Odoo)
  UPDATE companies co
  SET odoo_partner_id = sub.partner_id, updated_at = now()
  FROM (
    SELECT DISTINCT ON (co2.id)
      co2.id AS company_id,
      c.odoo_partner_id AS partner_id
    FROM companies co2
    JOIN contacts c
      ON c.odoo_partner_id IS NOT NULL
      AND c.company IS NOT NULL
      AND similarity(co2.canonical_name, lower(c.company)) >= 0.6
    WHERE co2.odoo_partner_id IS NULL
      AND co2.canonical_name IS NOT NULL
    ORDER BY co2.id, similarity(co2.canonical_name, lower(c.company)) DESC
  ) sub
  WHERE co.id = sub.company_id;

  step3_companies_to_odoo := step3_companies_to_odoo + (
    SELECT count(*) FROM companies
    WHERE odoo_partner_id IS NOT NULL
      AND updated_at >= now() - interval '5 seconds'
  ) - step3_companies_to_odoo;

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
  GET DIAGNOSTICS step4_contacts_via_odoo = ROW_COUNT;

  -- ========================================================================
  -- Step 5: Propagate commercial_partner_id
  -- If contact.company_id is set and company has odoo_partner_id,
  -- set contact.commercial_partner_id = company.odoo_partner_id
  -- ========================================================================
  UPDATE contacts c
  SET commercial_partner_id = co.odoo_partner_id, updated_at = now()
  FROM companies co
  WHERE c.commercial_partner_id IS NULL
    AND c.company_id IS NOT NULL
    AND c.company_id = co.id
    AND co.odoo_partner_id IS NOT NULL;
  GET DIAGNOSTICS step5_propagated = ROW_COUNT;

  -- ========================================================================
  -- Step 6 (bonus): Fill company domains from contact emails where missing
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
  GET DIAGNOSTICS step6_domains_filled = ROW_COUNT;

  RETURN jsonb_build_object(
    'contacts_linked_to_companies', step1_contacts_to_companies,
    'contacts_linked_to_odoo', step2_contacts_to_odoo,
    'companies_linked_to_odoo', step3_companies_to_odoo,
    'contacts_linked_via_odoo_partner', step4_contacts_via_odoo,
    'commercial_partner_propagated', step5_propagated,
    'company_domains_filled', step6_domains_filled,
    'total_resolved', step1_contacts_to_companies + step2_contacts_to_odoo
      + step3_companies_to_odoo + step4_contacts_via_odoo
      + step5_propagated + step6_domains_filled,
    'resolved_at', now()
  );
END;
$$;
