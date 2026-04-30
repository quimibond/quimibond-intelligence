-- C4: Add is_non_operational flag to canonical_invoices for invoices that
-- are CFDIs but not operational sales/purchases (e.g. sale-leaseback,
-- venta de activo fijo, etc). These distort revenue MoM/YoY when included.
--
-- Current known cases:
--   INV/2026/03/0173 LEASING LEPEZO $13.16M (sale-leaseback)
--   INV/2025/12/0036 LEASING LEPEZO $5.07M  (sale-leaseback)
--
-- The book-keeping side correctly routes these to 704.23.0003 UTILIDAD EN
-- VENTA DE ACTIVO FIJO (income_other), not 401.* — so the P&L 401+402
-- view already excludes them. This flag enables canonical_invoices
-- queries (homepage helpers, /ventas, /cobranza) to do the same.
--
-- Applied via supabase MCP apply_migration on 2026-04-30 by Claude.
ALTER TABLE canonical_invoices
ADD COLUMN IF NOT EXISTS is_non_operational boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN canonical_invoices.is_non_operational IS
'TRUE if this CFDI is a non-operational transaction (sale-leaseback, asset disposal, intercompany loan invoice, etc). Set manually. Operational queries should filter this out for clean revenue/MoM/aging analysis.';

UPDATE canonical_invoices
SET is_non_operational = true
WHERE odoo_name IN ('INV/2026/03/0173', 'INV/2025/12/0036')
  AND amount_total_mxn_resolved >= 5000000;

CREATE INDEX IF NOT EXISTS idx_canonical_invoices_is_non_operational
ON canonical_invoices(is_non_operational, direction, invoice_date_resolved)
WHERE is_non_operational = true;
