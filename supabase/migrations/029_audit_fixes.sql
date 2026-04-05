-- ============================================================================
-- Migration 029: Comprehensive Audit Fixes
-- APPLIED TO PRODUCTION 2026-04-05 via Supabase MCP
--
-- Production schema note: contacts.id is BIGINT (not uuid as in migration 001).
-- The consolidated redesign (migration 006) changed the schema.
-- email_recipients.contact_id BIGINT is correct.
--
-- Applied:
-- 029a_missing_indexes: idx_emails_kg_processed, idx_insights_state_created
-- 029b_improve_auto_link_triggers: exception handling + contacts fallback
-- ============================================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. PERFORMANCE INDEXES (applied via 029a_missing_indexes)
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_emails_kg_processed
  ON emails(kg_processed) WHERE kg_processed = false;

CREATE INDEX IF NOT EXISTS idx_insights_state_created
  ON agent_insights(state, created_at DESC)
  WHERE state IN ('new', 'seen');


-- ═══════════════════════════════════════════════════════════════
-- 2. IMPROVE AUTO-LINK TRIGGERS (applied via 029b_improve_auto_link_triggers)
--    Add contacts fallback + exception handling to prevent insert failures
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION auto_link_order_to_company()
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

CREATE OR REPLACE FUNCTION auto_resolve_odoo_company()
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

CREATE OR REPLACE FUNCTION auto_link_invoice_line_company()
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
