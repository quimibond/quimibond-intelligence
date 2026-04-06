-- Migration 031: Financial intelligence rules
-- Adds rule-based anomaly detection and enriches cashflow with Odoo financial data.
-- Applied to production via Supabase MCP on 2026-04-06.

-- New columns for richer financial data from Odoo
ALTER TABLE odoo_invoices ADD COLUMN IF NOT EXISTS amount_tax numeric;
ALTER TABLE odoo_invoices ADD COLUMN IF NOT EXISTS amount_untaxed numeric;
ALTER TABLE odoo_invoices ADD COLUMN IF NOT EXISTS amount_paid numeric;
ALTER TABLE odoo_invoices ADD COLUMN IF NOT EXISTS payment_term text;
ALTER TABLE odoo_invoices ADD COLUMN IF NOT EXISTS cfdi_uuid text;
ALTER TABLE odoo_invoices ADD COLUMN IF NOT EXISTS cfdi_sat_state text;

ALTER TABLE companies ADD COLUMN IF NOT EXISTS total_receivable numeric;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS total_payable numeric;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS total_invoiced_odoo numeric;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS total_overdue_odoo numeric;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS payment_term text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS supplier_payment_term text;

ALTER TABLE odoo_products ADD COLUMN IF NOT EXISTS avg_cost numeric;
ALTER TABLE odoo_products ADD COLUMN IF NOT EXISTS weight numeric;

-- Trigger to extract payment terms from odoo_context
CREATE OR REPLACE FUNCTION extract_company_payment_terms()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.odoo_context IS NOT NULL THEN
    IF NEW.odoo_context->>'payment_term' IS NOT NULL AND NEW.odoo_context->>'payment_term' != 'null' THEN
      NEW.payment_term := NEW.odoo_context->>'payment_term';
    END IF;
    IF NEW.odoo_context->>'supplier_payment_term' IS NOT NULL AND NEW.odoo_context->>'supplier_payment_term' != 'null' THEN
      NEW.supplier_payment_term := NEW.odoo_context->>'supplier_payment_term';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_extract_payment_terms ON companies;
CREATE TRIGGER trg_extract_payment_terms
  BEFORE INSERT OR UPDATE OF odoo_context ON companies
  FOR EACH ROW EXECUTE FUNCTION extract_company_payment_terms();
