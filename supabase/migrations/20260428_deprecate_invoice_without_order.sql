-- 2026-04-28: Deprecate invoice.without_order — matching mechanism is fundamentally broken.
--
-- BACKGROUND
-- _sp4_run_extra block flags out_invoice / in_invoice in last 365d that
-- don't match an SO/PO via:
--   NOT EXISTS (SELECT 1 FROM canonical_sale_orders so
--               WHERE so.name = ci.odoo_ref OR so.name = ci.odoo_name)
--   NOT EXISTS (SELECT 1 FROM canonical_purchase_orders po
--               WHERE po.name = ci.odoo_ref OR po.name = ci.odoo_name)
--
-- DISCOVERY (2026-04-28)
-- ci.odoo_name = 'INV/2025/07/0046' (invoice number)
-- ci.odoo_ref  = ''  or  'OC.25/05334' (customer PO from cliente)
-- canonical_sale_orders.name = 'SO/2026/0001'
-- These NEVER match. The proper SO link is the Odoo `invoice_origin` field
-- which isn't synced to Supabase. Of 1,748 open issues:
--   1,573 are out_invoice INV/* — all unmatchable by current logic
--      84 are in_invoice NOM/* — payroll, no PO needed
--      80 are misc (D, FA, CAM, IMSS, TAX) — heterogeneous, mostly no PO
--
-- Sometimes the match accidentally works (when ref happens to look like SO),
-- so not 100% false positives, but the design is broken.
--
-- DECISION
-- Deprecate. Auto-resolve all 1,748 open. If SP14 redesigns with proper
-- invoice_origin linkage, re-enable.

UPDATE audit_tolerances
SET enabled = false,
    notes = COALESCE(notes,'') ||
            ' [DISABLED 2026-04-28: matching mechanism broken — checks odoo_name/ref vs so.name but they never match by structure (INV/... ≠ SO/...). Proper link is invoice_origin field, not synced to Supabase. Re-enable if SP14 fixes the linkage.]'
WHERE invariant_key = 'invoice.without_order';

UPDATE reconciliation_issues
SET resolved_at = now(),
    resolution = 'auto_invariant_design_flaw',
    resolution_note = 'Invariant deprecated 2026-04-28: matching odoo_name/odoo_ref vs SO/PO name is structurally impossible (invoice names never match SO/PO names). Proper link via invoice_origin field not synced. See migration 20260428_deprecate_invoice_without_order.sql.'
WHERE invariant_key = 'invoice.without_order'
  AND resolved_at IS NULL;
