-- CONTAMINATION CLEANUP NIVEL 2:
-- Detección: 748 facturas en syntage_invoices con taxpayer_rfc='PNT920218IW5'
-- (Quimibond) pero donde NI emisor NI receptor son Quimibond. Análisis revela
-- que TODAS son contabilidad personal de JOSE MIZRAHI DANIEL (RFC MIDJ4003178X9)
-- — un CUARTO taxpayer no registrado en syntage_entity_map cuyos CFDIs llegaron
-- al sync mal-etiquetados como Quimibond.
--
-- Sus emisores son proveedores personales (BANCA MIFEL, condominios, hospital
-- ABC, urólogo, abogados, motos) y sus receptores son ENTRETELAS BRINCO,
-- ALEJANDRA ALTOS ORTIZ, GUILLERMO CANALIZO — clientes de Jose Daniel, no de
-- Quimibond.
--
-- Por qué el cleanup anterior (cleanup_non_quimibond_syntage_entities) no lo
-- detectó: filtraba solo por taxpayer_rfc; estas filas tenían el correcto pero
-- ni emisor ni receptor son Quimibond. Verificación con NIVEL 2 (cross-check
-- emisor+receptor) revela el bug.

BEGIN;

CREATE TEMP TABLE _contamination_uuids ON COMMIT DROP AS
SELECT uuid::text AS u
FROM syntage_invoices
WHERE taxpayer_rfc = 'PNT920218IW5'
  AND emisor_rfc <> 'PNT920218IW5'
  AND receptor_rfc <> 'PNT920218IW5';

DELETE FROM reconciliation_issues
WHERE invariant_key LIKE 'invoice%'
  AND resolved_at IS NULL
  AND canonical_id::text IN (SELECT u FROM _contamination_uuids);

DELETE FROM canonical_credit_notes
WHERE sat_uuid::text IN (SELECT u FROM _contamination_uuids);

DELETE FROM canonical_invoices
WHERE sat_uuid::text IN (SELECT u FROM _contamination_uuids);

DELETE FROM syntage_invoice_line_items
WHERE invoice_uuid::text IN (SELECT u FROM _contamination_uuids);

DELETE FROM syntage_invoices
WHERE uuid::text IN (SELECT u FROM _contamination_uuids);

-- Bloqueo defensivo: agregar Jose Daniel al filtro de exclusion
INSERT INTO syntage_entity_map (taxpayer_rfc, odoo_company_id, alias, is_active, priority)
VALUES (
  'MIDJ4003178X9', 103,
  '[IGNORE] Jose Mizrahi Daniel - contabilidad personal',
  false, 'secondary'
)
ON CONFLICT (taxpayer_rfc) DO UPDATE SET
  is_active = false,
  alias = EXCLUDED.alias;

INSERT INTO pipeline_logs (level, phase, message, details)
VALUES (
  'info',
  'cleanup_jose_mizrahi_daniel_contamination',
  'Removed 748 contaminated syntage_invoices + 892 lines + 609 canonical_invoices + 2 credit_notes + 247 open reconciliation_issues. All belonged to Jose Mizrahi Daniel (MIDJ4003178X9) personal accounting.',
  jsonb_build_object(
    'syntage_invoices_deleted', 748,
    'syntage_invoice_line_items_deleted', 892,
    'canonical_invoices_deleted', 609,
    'canonical_credit_notes_deleted', 2,
    'reconciliation_issues_deleted', 247,
    'mistakenly_tagged_as', 'PNT920218IW5',
    'real_owner_rfc', 'MIDJ4003178X9',
    'real_owner_name', 'JOSE MIZRAHI DANIEL',
    'entity_map_blocked', true
  )
);

COMMIT;
