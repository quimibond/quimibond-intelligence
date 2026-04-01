-- ============================================================================
-- Migration 028: Invoice Lines Table + RFC Field on Companies
--
-- 1. New table odoo_invoice_lines (from account.move.line)
-- 2. Add rfc column to companies (for CFDI cross-reference)
-- 3. Auto-link company_id on invoice lines (same pattern as order lines)
-- 4. Auto-link cfdi_documents to companies by RFC
-- ============================================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. INVOICE LINES TABLE
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS odoo_invoice_lines (
  id bigserial PRIMARY KEY,
  odoo_line_id int NOT NULL,
  odoo_move_id int,
  company_id bigint REFERENCES companies(id) ON DELETE SET NULL,
  odoo_partner_id int,
  move_name text,                    -- invoice number (e.g. INV/2026/0001)
  move_type text,                    -- out_invoice, out_refund, in_invoice, in_refund
  invoice_date date,
  odoo_product_id int,
  product_name text,
  quantity numeric DEFAULT 0,
  price_unit numeric DEFAULT 0,
  discount numeric DEFAULT 0,
  price_subtotal numeric DEFAULT 0,
  price_total numeric DEFAULT 0,
  synced_at timestamptz DEFAULT now(),
  UNIQUE(odoo_line_id)
);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_partner ON odoo_invoice_lines(odoo_partner_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_product ON odoo_invoice_lines(odoo_product_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_move ON odoo_invoice_lines(odoo_move_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_date ON odoo_invoice_lines(invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_company ON odoo_invoice_lines(company_id);

ALTER TABLE odoo_invoice_lines ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'odoo_invoice_lines' AND policyname = 'anon_read_odoo_invoice_lines'
  ) THEN
    CREATE POLICY "anon_read_odoo_invoice_lines" ON odoo_invoice_lines FOR SELECT TO anon USING (true);
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════
-- 2. AUTO-LINK company_id ON INVOICE LINES
--    Reuses auto_link_order_company() from migration 027
-- ═══════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_auto_link_invoice_line_company ON odoo_invoice_lines;
CREATE TRIGGER trg_auto_link_invoice_line_company
  BEFORE INSERT OR UPDATE ON odoo_invoice_lines
  FOR EACH ROW
  EXECUTE FUNCTION auto_link_order_company();


-- ═══════════════════════════════════════════════════════════════
-- 3. ADD RFC COLUMN TO COMPANIES
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE companies ADD COLUMN IF NOT EXISTS rfc text;

CREATE INDEX IF NOT EXISTS idx_companies_rfc ON companies(rfc) WHERE rfc IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════
-- 4. AUTO-LINK cfdi_documents TO COMPANIES BY RFC
--    When a company's RFC is set/updated, link matching CFDIs
-- ═══════════════════════════════════════════════════════════════

-- Only create if cfdi_documents table exists (it may have been created
-- via schema evolution or manually)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'cfdi_documents' AND table_schema = 'public'
  ) THEN
    -- Add company_id column to cfdi_documents if not exists
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'cfdi_documents' AND column_name = 'company_id'
    ) THEN
      ALTER TABLE cfdi_documents ADD COLUMN company_id bigint REFERENCES companies(id) ON DELETE SET NULL;
      CREATE INDEX idx_cfdi_company ON cfdi_documents(company_id);
    END IF;

    -- Function: when companies.rfc is updated, link matching cfdi_documents
    CREATE OR REPLACE FUNCTION auto_link_cfdi_by_rfc()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      IF NEW.rfc IS NOT NULL AND (OLD.rfc IS NULL OR OLD.rfc <> NEW.rfc) THEN
        UPDATE cfdi_documents
        SET company_id = NEW.id
        WHERE company_id IS NULL
          AND (emisor_rfc = NEW.rfc OR receptor_rfc = NEW.rfc);
      END IF;
      RETURN NEW;
    END;
    $fn$;

    DROP TRIGGER IF EXISTS trg_link_cfdi_on_rfc_update ON companies;
    CREATE TRIGGER trg_link_cfdi_on_rfc_update
      AFTER INSERT OR UPDATE OF rfc ON companies
      FOR EACH ROW
      EXECUTE FUNCTION auto_link_cfdi_by_rfc();

    -- Backfill: link existing cfdi_documents to companies by RFC
    UPDATE cfdi_documents cd
    SET company_id = c.id
    FROM companies c
    WHERE cd.company_id IS NULL
      AND c.rfc IS NOT NULL
      AND (cd.emisor_rfc = c.rfc OR cd.receptor_rfc = c.rfc);

  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════
-- 5. BACKFILL company_id ON NEW TABLE
--    Link existing invoice lines to companies
-- ═══════════════════════════════════════════════════════════════

-- This will be handled automatically by the trigger on first sync.
-- No backfill needed since the table is new.
