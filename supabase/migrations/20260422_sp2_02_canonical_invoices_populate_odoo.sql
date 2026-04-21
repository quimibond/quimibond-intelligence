-- SP2 Task 2: Populate canonical_invoices from odoo_invoices (invoices only; refunds → Task 8)
--
-- Notes vs original plan:
-- * Quimibond constant: companies.id=6707 (verified 2026-04-22 pre-gate).
--   "PRODUCTORA DE NO TEJIDOS QUIMIBOND" (rfc=PNT920218IW5, odoo_partner_id=5873).
--   Sibling 6458 "PREMIER WORLD CHEMICALS LLC" shares RFC (group subsidiary); both merge in SP3 MDM.
--   Original plan used id=1 — WRONG; corrected here.
-- * has_sat_record initialized to (cfdi_uuid IS NOT NULL) — preliminary; Task 3 verifies actual SAT presence.
-- * sat_uuid seeded directly from cfdi_uuid in INSERT (no separate UPDATE step needed).
-- * date_has_discrepancy NOT set explicitly — trg_canonical_invoices_date_discrepancy (BEFORE INSERT)
--   fires automatically and sets it from invoice_date vs fecha_timbrado.
-- * 3 rows expected to have NULL emisor/receptor_company_id (auto_link_invoice_company gap, acceptable).
--
-- Rollback: DELETE FROM canonical_invoices WHERE canonical_id LIKE 'odoo:%';

BEGIN;

INSERT INTO canonical_invoices (
  canonical_id, odoo_invoice_id, direction, move_type_odoo,
  amount_total_odoo, amount_untaxed_odoo, amount_tax_odoo, amount_residual_odoo,
  amount_paid_odoo, amount_total_mxn_odoo, amount_total_mxn_ops, amount_residual_mxn_odoo,
  currency_odoo, invoice_date, due_date_odoo, payment_date_odoo,
  state_odoo, payment_state_odoo, cfdi_sat_state_odoo, edi_state_odoo,
  odoo_name, cfdi_uuid_odoo, sat_uuid, odoo_ref, odoo_partner_id,
  payment_term_odoo, salesperson_user_id,
  emisor_company_id, receptor_company_id,
  has_odoo_record, has_sat_record, sources_present,
  resolved_from, match_confidence,
  source_hashes
)
SELECT
  'odoo:' || oi.id::text                   AS canonical_id,
  oi.id                                     AS odoo_invoice_id,
  CASE oi.move_type
    WHEN 'out_invoice' THEN 'issued'
    WHEN 'in_invoice'  THEN 'received'
    ELSE 'internal'
  END                                        AS direction,
  oi.move_type                               AS move_type_odoo,
  oi.amount_total,
  oi.amount_untaxed,
  oi.amount_tax,
  oi.amount_residual,
  oi.amount_paid,
  oi.amount_total_mxn,
  oi.amount_total_mxn                        AS amount_total_mxn_ops,
  oi.amount_residual_mxn,
  oi.currency,
  oi.invoice_date,
  oi.due_date,
  oi.payment_date,
  oi.state,
  oi.payment_state,
  oi.cfdi_sat_state,
  oi.edi_state,
  oi.name,
  oi.cfdi_uuid                               AS cfdi_uuid_odoo,
  oi.cfdi_uuid                               AS sat_uuid,   -- preliminary; Task 3 verifies
  oi.ref,
  oi.odoo_partner_id,
  oi.payment_term,
  oi.salesperson_user_id,
  -- Quimibond = 6707 (verified 2026-04-22 pre-gate; SP3 MDM will revise)
  CASE WHEN oi.move_type = 'out_invoice' THEN 6707 ELSE oi.company_id END AS emisor_company_id,
  CASE WHEN oi.move_type = 'in_invoice'  THEN 6707 ELSE oi.company_id END AS receptor_company_id,
  true                                       AS has_odoo_record,
  (oi.cfdi_uuid IS NOT NULL)                 AS has_sat_record,  -- preliminary
  CASE WHEN oi.cfdi_uuid IS NOT NULL
       THEN ARRAY['odoo','sat']
       ELSE ARRAY['odoo']
  END                                        AS sources_present,
  CASE WHEN oi.cfdi_uuid IS NOT NULL THEN 'odoo_uuid' ELSE NULL END AS resolved_from,
  CASE WHEN oi.cfdi_uuid IS NOT NULL THEN 'exact'     ELSE NULL END AS match_confidence,
  jsonb_build_object(
    'odoo_write_date', oi.write_date,
    'odoo_synced_at',  oi.synced_at
  )                                          AS source_hashes
FROM odoo_invoices oi
WHERE oi.move_type IN ('out_invoice','in_invoice')
ON CONFLICT (canonical_id) DO NOTHING;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES (
  'populate',
  'canonical_invoices',
  'SP2 Task 2: populate canonical_invoices from odoo_invoices (invoices only; refunds in Task 8). Quimibond=6707.',
  '20260422_sp2_02_canonical_invoices_populate_odoo.sql',
  'silver-sp2',
  true
);

COMMIT;
