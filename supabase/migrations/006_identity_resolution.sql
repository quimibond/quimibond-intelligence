-- ============================================================
-- Migration 006: Identity Resolution
-- Connects contacts ↔ entities ↔ odoo_partner_id
-- ============================================================

-- ── 1. Indexes for faster identity resolution ─────────────────
CREATE INDEX IF NOT EXISTS idx_entities_email
  ON entities(email) WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_entities_type_email
  ON entities(entity_type, email) WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_odoo_partner_id
  ON contacts(odoo_partner_id) WHERE odoo_partner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_entity_id
  ON contacts(entity_id) WHERE entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_company_lower
  ON contacts(lower(company)) WHERE company IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_companies_canonical
  ON companies(canonical_name) WHERE canonical_name IS NOT NULL;

-- ── 2. RPC: Resolve single contact identity by email ──────────
CREATE OR REPLACE FUNCTION resolve_contact_identity(
  p_email TEXT,
  p_odoo_partner_id BIGINT DEFAULT NULL,
  p_entity_id BIGINT DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE contacts SET
    odoo_partner_id = COALESCE(p_odoo_partner_id, contacts.odoo_partner_id),
    entity_id = COALESCE(p_entity_id, contacts.entity_id)
  WHERE email = lower(trim(p_email))
    AND (
      (p_odoo_partner_id IS NOT NULL AND contacts.odoo_partner_id IS NULL)
      OR (p_entity_id IS NOT NULL AND contacts.entity_id IS NULL)
    );
END;
$$;

-- ── 3. RPC: Batch resolve all identity links ──────────────────
CREATE OR REPLACE FUNCTION resolve_all_identities() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  linked_entities INT := 0;
  linked_companies INT := 0;
  linked_entity_companies INT := 0;
BEGIN
  -- Link contacts → entities (by exact email match)
  UPDATE contacts c SET entity_id = e.id
  FROM entities e
  WHERE c.entity_id IS NULL
    AND c.email IS NOT NULL
    AND e.entity_type = 'person'
    AND e.email IS NOT NULL
    AND lower(trim(e.email)) = lower(trim(c.email));
  GET DIAGNOSTICS linked_entities = ROW_COUNT;

  -- Link contacts → companies (by company name)
  UPDATE contacts c SET company_id = co.id
  FROM companies co
  WHERE c.company_id IS NULL
    AND c.company IS NOT NULL
    AND co.canonical_name IS NOT NULL
    AND lower(trim(c.company)) = co.canonical_name;
  GET DIAGNOSTICS linked_companies = ROW_COUNT;

  -- Link entities → companies (person entities with company field)
  UPDATE entities e SET company_id = co.id
  FROM companies co
  WHERE e.company_id IS NULL
    AND e.entity_type = 'person'
    AND e.attributes->>'company' IS NOT NULL
    AND co.canonical_name = lower(trim(e.attributes->>'company'));
  GET DIAGNOSTICS linked_entity_companies = ROW_COUNT;

  RETURN jsonb_build_object(
    'linked_entities', linked_entities,
    'linked_companies', linked_companies,
    'linked_entity_companies', linked_entity_companies
  );
END;
$$;

-- ── 4. Grant execute to anon/authenticated ────────────────────
GRANT EXECUTE ON FUNCTION resolve_contact_identity TO anon, authenticated;
GRANT EXECUTE ON FUNCTION resolve_all_identities TO anon, authenticated;

-- ── 5. Backfill: run initial identity resolution ──────────────
SELECT resolve_all_identities();
