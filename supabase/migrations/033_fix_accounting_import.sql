-- ============================================================================
-- Migration 033: Fix accounting data import
--
-- Fixes 5 critical issues found during accounting audit:
-- 1. Companies financial data not arriving (PostgREST schema cache + RPC)
-- 2. 2,688 invoices missing amount_tax/amount_untaxed/amount_paid
-- 3. (Fixed in qb19 sync_push.py: payments now include supplier invoices)
-- 4. 113 orphan invoices without company_id link
-- 5. odoo_manufacturing table missing in Supabase
-- ============================================================================


-- ═══════════════════════════════════════════════════════════════
-- 1. REFRESH POSTGREST SCHEMA CACHE
--    Ensures new columns from mig 031 are recognized in upserts
-- ═══════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════
-- 2. RPC: backfill_company_financials
--    Called by sync_push.py to update financial columns that
--    PostgREST upsert may miss due to stale schema cache.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION backfill_company_financials(data jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  partner_id text;
  fin jsonb;
BEGIN
  FOR partner_id, fin IN SELECT * FROM jsonb_each(data)
  LOOP
    UPDATE companies SET
      total_receivable = COALESCE((fin->>'total_receivable')::numeric, total_receivable),
      total_payable = COALESCE((fin->>'total_payable')::numeric, total_payable),
      total_invoiced_odoo = COALESCE((fin->>'total_invoiced_odoo')::numeric, total_invoiced_odoo),
      total_overdue_odoo = COALESCE((fin->>'total_overdue_odoo')::numeric, total_overdue_odoo),
      odoo_context = CASE
        WHEN fin->'odoo_context' IS NOT NULL AND fin->'odoo_context' != '{}'::jsonb
        THEN COALESCE(odoo_context, '{}'::jsonb) || (fin->'odoo_context')
        ELSE odoo_context
      END
    WHERE odoo_partner_id = partner_id::int;
  END LOOP;
END;
$$;


-- ═══════════════════════════════════════════════════════════════
-- 3. BACKFILL INVOICE FINANCIAL FIELDS
--    amount_paid can be computed: amount_total - amount_residual
--    amount_untaxed/amount_tax from invoice lines
-- ═══════════════════════════════════════════════════════════════

-- 3a. amount_paid (direct calculation)
UPDATE odoo_invoices
SET amount_paid = amount_total - amount_residual
WHERE amount_paid IS NULL
  AND amount_total IS NOT NULL
  AND amount_residual IS NOT NULL;

-- 3b. amount_untaxed from invoice lines (sum of price_subtotal)
UPDATE odoo_invoices oi
SET amount_untaxed = sub.line_subtotal
FROM (
  SELECT move_name, odoo_partner_id, sum(price_subtotal) as line_subtotal
  FROM odoo_invoice_lines
  GROUP BY move_name, odoo_partner_id
) sub
WHERE oi.name = sub.move_name
  AND oi.odoo_partner_id = sub.odoo_partner_id
  AND oi.amount_untaxed IS NULL
  AND sub.line_subtotal > 0;

-- 3c. amount_tax (derived: total - untaxed)
UPDATE odoo_invoices
SET amount_tax = amount_total - amount_untaxed
WHERE amount_tax IS NULL
  AND amount_untaxed IS NOT NULL
  AND amount_total IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════
-- 4. FIX ORPHAN INVOICES (relink company_id)
-- ═══════════════════════════════════════════════════════════════

-- Relink invoices where company exists but trigger didn't fire
UPDATE odoo_invoices oi
SET company_id = c.id
FROM companies c
WHERE oi.company_id IS NULL
  AND oi.odoo_partner_id = c.odoo_partner_id;

-- Same for invoice lines
UPDATE odoo_invoice_lines oil
SET company_id = c.id
FROM companies c
WHERE oil.company_id IS NULL
  AND oil.odoo_partner_id = c.odoo_partner_id;

-- Same for payments
UPDATE odoo_payments op
SET company_id = c.id
FROM companies c
WHERE op.company_id IS NULL
  AND op.odoo_partner_id = c.odoo_partner_id;


-- ═══════════════════════════════════════════════════════════════
-- 5. BACKFILL COMPANY FINANCIALS FROM INVOICE DATA
--    Until the next Odoo sync brings Odoo-computed values,
--    we compute approximations from the invoices we have.
-- ═══════════════════════════════════════════════════════════════

-- total_receivable: outstanding customer invoices
UPDATE companies c
SET total_receivable = sub.receivable
FROM (
  SELECT odoo_partner_id, round(sum(amount_residual)::numeric, 2) as receivable
  FROM odoo_invoices
  WHERE move_type IN ('out_invoice')
    AND payment_state IN ('not_paid', 'partial', 'in_payment')
    AND amount_residual > 0
  GROUP BY odoo_partner_id
) sub
WHERE c.odoo_partner_id = sub.odoo_partner_id
  AND (c.total_receivable IS NULL OR c.total_receivable = 0);

-- total_payable: outstanding supplier invoices
UPDATE companies c
SET total_payable = sub.payable
FROM (
  SELECT odoo_partner_id, round(sum(amount_residual)::numeric, 2) as payable
  FROM odoo_invoices
  WHERE move_type IN ('in_invoice')
    AND payment_state IN ('not_paid', 'partial', 'in_payment')
    AND amount_residual > 0
  GROUP BY odoo_partner_id
) sub
WHERE c.odoo_partner_id = sub.odoo_partner_id
  AND (c.total_payable IS NULL OR c.total_payable = 0);

-- total_invoiced_odoo: lifetime customer invoiced
UPDATE companies c
SET total_invoiced_odoo = sub.invoiced
FROM (
  SELECT odoo_partner_id, round(sum(amount_total)::numeric, 2) as invoiced
  FROM odoo_invoices
  WHERE move_type = 'out_invoice'
  GROUP BY odoo_partner_id
) sub
WHERE c.odoo_partner_id = sub.odoo_partner_id
  AND (c.total_invoiced_odoo IS NULL OR c.total_invoiced_odoo = 0);

-- total_overdue_odoo: overdue amount
UPDATE companies c
SET total_overdue_odoo = sub.overdue
FROM (
  SELECT odoo_partner_id, round(sum(amount_residual)::numeric, 2) as overdue
  FROM odoo_invoices
  WHERE move_type = 'out_invoice'
    AND payment_state IN ('not_paid', 'partial')
    AND days_overdue > 0
    AND amount_residual > 0
  GROUP BY odoo_partner_id
) sub
WHERE c.odoo_partner_id = sub.odoo_partner_id
  AND (c.total_overdue_odoo IS NULL OR c.total_overdue_odoo = 0);


-- ═══════════════════════════════════════════════════════════════
-- 6. CREATE odoo_manufacturing TABLE
--    sync_push.py sends data but table was never created
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS odoo_manufacturing (
  id bigserial PRIMARY KEY,
  odoo_production_id int NOT NULL,
  name text,
  product_name text,
  odoo_product_id int,
  qty_planned numeric DEFAULT 0,
  qty_produced numeric DEFAULT 0,
  state text,
  date_start timestamptz,
  date_finished timestamptz,
  create_date date,
  assigned_user text,
  synced_at timestamptz DEFAULT now(),
  UNIQUE(odoo_production_id)
);

CREATE INDEX IF NOT EXISTS idx_manufacturing_product ON odoo_manufacturing(odoo_product_id);
CREATE INDEX IF NOT EXISTS idx_manufacturing_state ON odoo_manufacturing(state);

ALTER TABLE odoo_manufacturing ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'odoo_manufacturing' AND policyname = 'anon_read_odoo_manufacturing'
  ) THEN
    CREATE POLICY "anon_read_odoo_manufacturing" ON odoo_manufacturing FOR SELECT TO anon USING (true);
  END IF;
END $$;


-- Final schema reload to pick up the new table
NOTIFY pgrst, 'reload schema';
