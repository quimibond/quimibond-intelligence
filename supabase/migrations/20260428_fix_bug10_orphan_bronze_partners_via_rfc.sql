-- 20260428_fix_bug10_orphan_bronze_partners_via_rfc.sql
-- ─────────────────────────────────────────────────────────────────────────
-- BUG #10: Bronze `companies` table tiene partner_ids cuyo canonical_company
-- NO está vinculado por odoo_partner_id, AUNQUE existe un canonical con el
-- MISMO RFC (linked a otro odoo_partner_id histórico).
--
-- Causa: Odoo permite múltiples res.partner con mismo RFC (data quality issue).
-- canonical_companies guarda UN solo odoo_partner_id (el primero asignado),
-- así que payments/invoices con los demás partner_ids quedan "stranded" —
-- apuntan a un odoo_partner_id que canonical_companies no reconoce.
--
-- Detectado vía audit 2026-04-28:
--   14 bronze orphans, 6 con tráfico real:
--   * SURTIDORA NACIONAL DE RODAMIENTOS (3601 vs canonical 71/partner=11424)
--     140 payments + 211 invoices
--   * PESA TECNOLOGIA (3420 vs canonical 383/partner=8847)
--     71 payments + 74 invoices
--   * LOPEZ SAINZ (3707 vs canonical 808/partner=3706)  11 + 12
--   * ATLAS COPCO (7950 vs canonical 13/partner=3548)    7 + 1
--   * LEAR MEXICAN SEATING (8095 vs canonical 2154/partner=8101)  5 + 14
--   * PREMIER WORLD CHEMICALS (3851 vs canonical 868 = QUIMIBOND, RFC capturado mal en Odoo)  3 + 3
--   Total: 237 payments + 315 invoices stranded
--
-- FIX: re-puntear FKs vía RFC del bronze companies. Usa RFC como identificador
-- estable (excluyendo genéricos + Quimibond personal MITJ991130TV7).
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- canonical_payments
UPDATE canonical_payments cp
SET counterparty_canonical_company_id = cc.id,
    last_reconciled_at = now()
FROM companies c, canonical_companies cc
WHERE cp.odoo_partner_id = c.odoo_partner_id
  AND c.rfc = cc.rfc
  AND c.rfc IS NOT NULL AND c.rfc <> ''
  AND c.rfc NOT IN ('XAXX010101000','XEXX010101000','MITJ991130TV7')
  AND NOT EXISTS (SELECT 1 FROM canonical_companies ccx WHERE ccx.odoo_partner_id = cp.odoo_partner_id)
  AND cp.counterparty_canonical_company_id IS DISTINCT FROM cc.id;

-- canonical_invoices.receptor (issued)
UPDATE canonical_invoices ci
SET receptor_canonical_company_id = cc.id,
    last_reconciled_at = now()
FROM odoo_invoices oi, companies c, canonical_companies cc
WHERE ci.odoo_invoice_id = oi.id
  AND oi.odoo_partner_id = c.odoo_partner_id
  AND c.rfc = cc.rfc
  AND c.rfc IS NOT NULL AND c.rfc <> ''
  AND c.rfc NOT IN ('XAXX010101000','XEXX010101000','MITJ991130TV7')
  AND NOT EXISTS (SELECT 1 FROM canonical_companies ccx WHERE ccx.odoo_partner_id = oi.odoo_partner_id)
  AND ci.direction = 'issued'
  AND ci.receptor_canonical_company_id IS DISTINCT FROM cc.id;

-- canonical_invoices.emisor (received)
UPDATE canonical_invoices ci
SET emisor_canonical_company_id = cc.id,
    last_reconciled_at = now()
FROM odoo_invoices oi, companies c, canonical_companies cc
WHERE ci.odoo_invoice_id = oi.id
  AND oi.odoo_partner_id = c.odoo_partner_id
  AND c.rfc = cc.rfc
  AND c.rfc IS NOT NULL AND c.rfc <> ''
  AND c.rfc NOT IN ('XAXX010101000','XEXX010101000','MITJ991130TV7')
  AND NOT EXISTS (SELECT 1 FROM canonical_companies ccx WHERE ccx.odoo_partner_id = oi.odoo_partner_id)
  AND ci.direction = 'received'
  AND ci.emisor_canonical_company_id IS DISTINCT FROM cc.id;

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES (
  'data_fix', 'canonical_invoices,canonical_payments',
  'BUG #10 fix: re-point FKs vía RFC for 14 bronze orphan partner_ids whose canonical_companies are linked to OTHER odoo_partner_ids (Odoo allows multiple res.partner per RFC). 237 payments + 315 invoices re-pointed. Top affected: SURTIDORA, PESA, LEAR, ATLAS COPCO.',
  '20260428_fix_bug10_orphan_bronze_partners_via_rfc.sql', 'audit-mdm-cleanup', true
);

COMMIT;
