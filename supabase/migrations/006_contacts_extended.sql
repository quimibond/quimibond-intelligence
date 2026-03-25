-- ============================================================
-- Migration 006: Extended contacts columns for Odoo sync
--
-- The qb19 backend PATCHes several fields on the contacts table
-- that were never added to the schema. PostgREST returns 400
-- for unknown columns, causing all enrichment PATCHes to fail.
-- ============================================================

-- ── 1. Odoo integration columns ─────────────────────────────
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS odoo_partner_id       integer,
  ADD COLUMN IF NOT EXISTS commercial_partner_id integer,
  ADD COLUMN IF NOT EXISTS company_id            uuid REFERENCES companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_customer           boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_supplier           boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS odoo_context          jsonb;

-- ── 2. Person profile columns (merged from person_profiles) ─
-- The qb19 backend writes profiles directly to contacts
-- instead of the separate person_profiles table.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS role                  text,
  ADD COLUMN IF NOT EXISTS department            text,
  ADD COLUMN IF NOT EXISTS decision_power        text,
  ADD COLUMN IF NOT EXISTS communication_style   text,
  ADD COLUMN IF NOT EXISTS language_preference   text,
  ADD COLUMN IF NOT EXISTS key_interests         text,
  ADD COLUMN IF NOT EXISTS personality_notes     text,
  ADD COLUMN IF NOT EXISTS negotiation_style     text,
  ADD COLUMN IF NOT EXISTS response_pattern      text,
  ADD COLUMN IF NOT EXISTS influence_on_deals    text;

-- ── 3. Activity & scoring columns ───────────────────────────
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS interaction_count     integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_activity         timestamptz,
  ADD COLUMN IF NOT EXISTS score_breakdown       jsonb DEFAULT '{}';

-- ── 4. Indexes for common lookups ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_contacts_odoo_partner
  ON contacts (odoo_partner_id) WHERE odoo_partner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_company_id
  ON contacts (company_id) WHERE company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_commercial_partner
  ON contacts (commercial_partner_id) WHERE commercial_partner_id IS NOT NULL;

-- ── 5. Update upsert_contact RPC to accept new parameters ──
CREATE OR REPLACE FUNCTION upsert_contact(
  p_email        text,
  p_name         text DEFAULT NULL,
  p_company      text DEFAULT NULL,
  p_company_name text DEFAULT NULL,
  p_contact_type text DEFAULT NULL,
  p_department   text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
  v_company text;
BEGIN
  -- Accept either p_company or p_company_name for backwards compat
  v_company := COALESCE(p_company_name, p_company);

  INSERT INTO contacts (email, name, company, contact_type, department)
  VALUES (p_email, p_name, v_company, p_contact_type, p_department)
  ON CONFLICT (email) DO UPDATE SET
    name         = COALESCE(EXCLUDED.name, contacts.name),
    company      = COALESCE(EXCLUDED.company, contacts.company),
    contact_type = COALESCE(EXCLUDED.contact_type, contacts.contact_type),
    department   = COALESCE(EXCLUDED.department, contacts.department),
    updated_at   = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_contact(text, text, text, text, text, text) TO anon;
