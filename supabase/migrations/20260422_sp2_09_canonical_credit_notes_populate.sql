BEGIN;

-- ====================================================================
-- 9a. Insert Odoo refunds (out_refund + in_refund)
-- ====================================================================
INSERT INTO canonical_credit_notes (
  canonical_id, odoo_invoice_id, direction, move_type_odoo,
  amount_total_odoo, amount_total_mxn_odoo,
  currency_odoo, invoice_date, odoo_partner_id,
  state_odoo,
  emisor_company_id, receptor_company_id,
  sat_uuid,
  has_odoo_record, sources_present, source_hashes
)
SELECT
  CASE WHEN oi.cfdi_uuid IS NOT NULL THEN oi.cfdi_uuid ELSE 'odoo:' || oi.id::text END,
  oi.id,
  CASE WHEN oi.move_type='out_refund' THEN 'issued' ELSE 'received' END,
  oi.move_type,
  oi.amount_total, oi.amount_total_mxn,
  oi.currency, oi.invoice_date, oi.odoo_partner_id,
  oi.state,
  -- Quimibond=6707 verified via Tasks 2+4
  CASE WHEN oi.move_type='out_refund' THEN 6707 ELSE oi.company_id END,
  CASE WHEN oi.move_type='in_refund'  THEN 6707 ELSE oi.company_id END,
  oi.cfdi_uuid,
  true, ARRAY['odoo'],
  jsonb_build_object('odoo_write_date', oi.write_date, 'odoo_synced_at', oi.synced_at)
FROM odoo_invoices oi
WHERE oi.move_type IN ('out_refund','in_refund')
ON CONFLICT (canonical_id) DO NOTHING;

-- ====================================================================
-- 9b. Update SAT fields where sat_uuid already seeded matches syntage E
-- ====================================================================
UPDATE canonical_credit_notes ccn
SET
  tipo_comprobante_sat = si.tipo_comprobante,
  amount_total_sat = si.total,
  amount_total_mxn_sat = si.total_mxn,
  currency_sat = si.moneda,
  tipo_cambio_sat = si.tipo_cambio,
  fecha_emision = si.fecha_emision,
  fecha_timbrado = si.fecha_timbrado,
  fecha_cancelacion = si.fecha_cancelacion,
  estado_sat = si.estado_sat,
  emisor_rfc = si.emisor_rfc, emisor_nombre = si.emisor_nombre,
  receptor_rfc = si.receptor_rfc, receptor_nombre = si.receptor_nombre,
  related_invoice_uuid = si.raw_payload #>> '{relations,0,relatedInvoiceUuid}',
  tipo_relacion = (si.raw_payload #>> '{relations,0,type}'),
  has_sat_record = true,
  sources_present = ARRAY(SELECT DISTINCT unnest(ccn.sources_present || ARRAY['sat']))
FROM syntage_invoices si
WHERE si.uuid = ccn.sat_uuid AND si.tipo_comprobante='E';

-- ====================================================================
-- 9c. Insert SAT-only E rows (no Odoo counterpart)
-- ====================================================================
INSERT INTO canonical_credit_notes (
  canonical_id, sat_uuid, direction, tipo_comprobante_sat,
  amount_total_sat, amount_total_mxn_sat, currency_sat, tipo_cambio_sat,
  fecha_emision, fecha_timbrado, fecha_cancelacion, estado_sat,
  emisor_rfc, emisor_nombre, receptor_rfc, receptor_nombre,
  related_invoice_uuid, tipo_relacion,
  has_odoo_record, has_sat_record, sources_present, source_hashes
)
SELECT
  si.uuid,
  si.uuid,
  si.direction,  -- English native: 'issued'/'received' -- matches canonical_credit_notes CHECK
  si.tipo_comprobante,
  si.total, si.total_mxn, si.moneda, si.tipo_cambio,
  si.fecha_emision, si.fecha_timbrado, si.fecha_cancelacion, si.estado_sat,
  si.emisor_rfc, si.emisor_nombre, si.receptor_rfc, si.receptor_nombre,
  si.raw_payload #>> '{relations,0,relatedInvoiceUuid}',
  (si.raw_payload #>> '{relations,0,type}'),
  false, true, ARRAY['sat'],
  jsonb_build_object('sat_synced_at', si.synced_at)
FROM syntage_invoices si
WHERE si.tipo_comprobante='E'
  AND NOT EXISTS (SELECT 1 FROM canonical_credit_notes ccn WHERE ccn.sat_uuid = si.uuid)
ON CONFLICT (canonical_id) DO NOTHING;

-- ====================================================================
-- 9d. Resolve related_invoice_canonical_id (back-link to canonical_invoices.sat_uuid)
-- ====================================================================
UPDATE canonical_credit_notes ccn
SET related_invoice_canonical_id = ci.canonical_id
FROM canonical_invoices ci
WHERE ci.sat_uuid = ccn.related_invoice_uuid
  AND ccn.related_invoice_canonical_id IS NULL
  AND ccn.related_invoice_uuid IS NOT NULL;

-- ====================================================================
-- 9e. Survivorship + completeness_score
-- ====================================================================
UPDATE canonical_credit_notes ccn
SET
  amount_total_resolved = COALESCE(ccn.amount_total_sat, ccn.amount_total_odoo),
  amount_total_mxn_resolved = COALESCE(ccn.amount_total_mxn_sat, ccn.amount_total_mxn_odoo),
  completeness_score = CASE
    WHEN has_odoo_record AND has_sat_record THEN 1.000
    WHEN has_odoo_record OR  has_sat_record THEN 0.500
    ELSE 0.000
  END,
  sources_missing = CASE
    WHEN has_odoo_record AND has_sat_record THEN '{}'::text[]
    WHEN has_odoo_record AND NOT has_sat_record THEN ARRAY['sat']
    WHEN NOT has_odoo_record AND has_sat_record THEN ARRAY['odoo']
    ELSE ARRAY['odoo','sat']
  END;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('populate','canonical_credit_notes',
  'SP2 Task 9: populate + related resolution via relations[0].relatedInvoiceUuid (NOT cfdiRelacionados)',
  '20260422_sp2_09_canonical_credit_notes_populate.sql','silver-sp2',true);

COMMIT;
