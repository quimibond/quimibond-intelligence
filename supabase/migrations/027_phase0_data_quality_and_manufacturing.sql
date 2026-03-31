-- ============================================================================
-- Migration 027: Phase 0 — Data Quality Fixes + Manufacturing Table
--
-- 1. Auto-linkage triggers for company_id on invoices/orders/deliveries
-- 2. Auto-linkage trigger for entity_id on contacts/companies
-- 3. Manufacturing orders table (from mrp.production)
-- 4. Improved auto_resolve functions
-- ============================================================================

-- ═══════════════════════════════════════════════════════════════
-- 1. MANUFACTURING ORDERS TABLE
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS odoo_manufacturing (
  id bigserial PRIMARY KEY,
  odoo_production_id int NOT NULL,
  name text NOT NULL,
  product_name text,
  odoo_product_id int,
  company_id bigint REFERENCES companies(id) ON DELETE SET NULL,
  qty_planned numeric DEFAULT 0,
  qty_produced numeric DEFAULT 0,
  state text,                       -- 'draft', 'confirmed', 'progress', 'done', 'cancel'
  date_start timestamptz,
  date_finished timestamptz,
  create_date date,
  assigned_user text,
  origin text,                      -- source document (sale order, etc.)
  synced_at timestamptz DEFAULT now(),
  UNIQUE(odoo_production_id)
);

CREATE INDEX IF NOT EXISTS idx_manufacturing_state ON odoo_manufacturing(state) WHERE state NOT IN ('done', 'cancel');
CREATE INDEX IF NOT EXISTS idx_manufacturing_product ON odoo_manufacturing(odoo_product_id);

ALTER TABLE odoo_manufacturing ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'odoo_manufacturing' AND policyname = 'anon_read_odoo_manufacturing'
  ) THEN
    CREATE POLICY "anon_read_odoo_manufacturing" ON odoo_manufacturing FOR SELECT TO anon USING (true);
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════
-- 2. AUTO-LINK company_id ON INVOICES (trigger on insert/update)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION auto_link_invoice_company()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.company_id IS NULL AND NEW.odoo_partner_id IS NOT NULL THEN
    -- Try direct match via companies.odoo_partner_id
    SELECT id INTO NEW.company_id
    FROM companies
    WHERE odoo_partner_id = NEW.odoo_partner_id
    LIMIT 1;

    -- Fallback: match via contacts
    IF NEW.company_id IS NULL THEN
      SELECT company_id INTO NEW.company_id
      FROM contacts
      WHERE odoo_partner_id = NEW.odoo_partner_id
        AND company_id IS NOT NULL
      LIMIT 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_link_invoice_company ON odoo_invoices;
CREATE TRIGGER trg_auto_link_invoice_company
  BEFORE INSERT OR UPDATE ON odoo_invoices
  FOR EACH ROW
  EXECUTE FUNCTION auto_link_invoice_company();


-- ═══════════════════════════════════════════════════════════════
-- 3. AUTO-LINK company_id ON ORDER LINES
-- ═══════════════════════════════════════════════════════════════

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
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_link_order_company ON odoo_order_lines;
CREATE TRIGGER trg_auto_link_order_company
  BEFORE INSERT OR UPDATE ON odoo_order_lines
  FOR EACH ROW
  EXECUTE FUNCTION auto_link_order_company();


-- ═══════════════════════════════════════════════════════════════
-- 4. AUTO-LINK company_id ON DELIVERIES
-- ═══════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_auto_link_delivery_company ON odoo_deliveries;
CREATE TRIGGER trg_auto_link_delivery_company
  BEFORE INSERT OR UPDATE ON odoo_deliveries
  FOR EACH ROW
  EXECUTE FUNCTION auto_link_order_company();  -- Reuse same function


-- ═══════════════════════════════════════════════════════════════
-- 5. AUTO-LINK entity_id ON CONTACTS (improved)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION auto_link_contact_entity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Link entity_id by email match
  IF NEW.entity_id IS NULL AND NEW.email IS NOT NULL THEN
    SELECT id INTO NEW.entity_id
    FROM entities
    WHERE entity_type = 'person' AND email = NEW.email
    LIMIT 1;
  END IF;

  -- Link company_id by name if still null
  IF NEW.company_id IS NULL AND NEW.odoo_partner_id IS NOT NULL THEN
    SELECT id INTO NEW.company_id
    FROM companies
    WHERE odoo_partner_id = NEW.odoo_partner_id
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_link_contact_entity ON contacts;
CREATE TRIGGER trg_auto_link_contact_entity
  BEFORE INSERT OR UPDATE ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION auto_link_contact_entity();


-- ═══════════════════════════════════════════════════════════════
-- 6. AUTO-LINK entity_id ON COMPANIES
-- ═══════════════════════════════════════════════════════════════

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

  -- Fallback: name matching
  IF NEW.entity_id IS NULL AND NEW.canonical_name IS NOT NULL THEN
    SELECT id INTO NEW.entity_id
    FROM entities
    WHERE entity_type = 'company'
      AND LOWER(TRIM(canonical_name)) = LOWER(TRIM(NEW.canonical_name))
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_link_company_entity ON companies;
CREATE TRIGGER trg_auto_link_company_entity
  BEFORE INSERT OR UPDATE ON companies
  FOR EACH ROW
  EXECUTE FUNCTION auto_link_company_entity();


-- ═══════════════════════════════════════════════════════════════
-- 7. PREVENT GARBAGE: Don't insert companies with no useful data
--    (this is informational — the real fix is in qb19 sync logic)
-- ═══════════════════════════════════════════════════════════════

-- Add domain column to companies if not exists
ALTER TABLE companies ADD COLUMN IF NOT EXISTS domain text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS city text;

-- Index for domain-based lookups
CREATE INDEX IF NOT EXISTS idx_companies_domain ON companies(domain) WHERE domain IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════
-- 8. IMPROVED RPC: Batch link all unlinked records
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fix_all_company_links()
RETURNS TABLE(invoices_fixed int, orders_fixed int, deliveries_fixed int)
LANGUAGE plpgsql
AS $$
DECLARE
  v_inv int := 0;
  v_ord int := 0;
  v_del int := 0;
BEGIN
  -- Invoices
  WITH updated AS (
    UPDATE odoo_invoices inv
    SET company_id = co.id
    FROM companies co
    WHERE inv.company_id IS NULL
      AND inv.odoo_partner_id = co.odoo_partner_id
      AND co.odoo_partner_id IS NOT NULL
    RETURNING inv.id
  ) SELECT COUNT(*) INTO v_inv FROM updated;

  -- Order lines
  WITH updated AS (
    UPDATE odoo_order_lines ol
    SET company_id = co.id
    FROM companies co
    WHERE ol.company_id IS NULL
      AND ol.odoo_partner_id = co.odoo_partner_id
      AND co.odoo_partner_id IS NOT NULL
    RETURNING ol.id
  ) SELECT COUNT(*) INTO v_ord FROM updated;

  -- Deliveries
  WITH updated AS (
    UPDATE odoo_deliveries d
    SET company_id = co.id
    FROM companies co
    WHERE d.company_id IS NULL
      AND d.odoo_partner_id = co.odoo_partner_id
      AND co.odoo_partner_id IS NOT NULL
    RETURNING d.id
  ) SELECT COUNT(*) INTO v_del FROM updated;

  RETURN QUERY SELECT v_inv, v_ord, v_del;
END;
$$;
