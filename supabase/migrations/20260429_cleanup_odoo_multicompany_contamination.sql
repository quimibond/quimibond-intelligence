-- Cleanup nivel 3: contaminación Odoo multi-company.
--
-- Detección: Odoo es multi-company. company_id=1 es Quimibond (la entidad real),
-- pero el Odoo también contiene companies 2, 3, 4 (probablemente del papá/abuelo
-- Mizrahi para sus negocios personales). El sync trae todas las companies y
-- canonicaliza sus invoices como si fueran de Quimibond.
--
-- Síntoma reportado por el CEO: en /cobranza aparece "Quimibond le debe a
-- Quimibond $24M" + Alejandra Altos Ortiz como cliente. Investigación reveló
-- que esas son operaciones del Mizrahi family en companies 2/3/4.
--
-- Verificación empírica (pre-cleanup):
--   - 143 facturas auto-Quimibond en odoo_company_id=2 ($38.3M)
--   - 5 facturas auto-Quimibond en odoo_company_id=3 ($310K)
--   - 8 facturas Alejandra en odoo_company_id=3
--
-- Alcance total contaminación nivel 3:
--   - 524 odoo_invoices con company_id != 1
--   - 506 canonical_invoices derivadas
--   - 1 odoo_delivery con company_id=7
--
-- Acción separada (fuera de DB): el sync de Odoo (en otro repo / connector)
-- debería filtrar company_id=1 en origen para que esto no se repita en
-- futuros syncs.
--
-- Nota: canonical_companies referenciadas por bad data NO se borran porque
-- tienen FK a canonical_contacts (rompería el grafo). Quedan inertes con
-- 0 invoices después del cleanup.

BEGIN;

CREATE TEMP TABLE _bad_odoo_invoice_ids ON COMMIT DROP AS
SELECT id FROM odoo_invoices WHERE odoo_company_id <> 1;

CREATE TEMP TABLE _bad_canonical_invoice_uuids ON COMMIT DROP AS
SELECT sat_uuid::text AS uuid FROM canonical_invoices
WHERE odoo_invoice_id IN (SELECT id FROM _bad_odoo_invoice_ids)
  AND sat_uuid IS NOT NULL;

DELETE FROM reconciliation_issues
WHERE invariant_key LIKE 'invoice%'
  AND resolved_at IS NULL
  AND canonical_id::text IN (SELECT uuid FROM _bad_canonical_invoice_uuids);

DELETE FROM canonical_credit_notes
WHERE sat_uuid::text IN (SELECT uuid FROM _bad_canonical_invoice_uuids);

DELETE FROM canonical_invoices
WHERE odoo_invoice_id IN (SELECT id FROM _bad_odoo_invoice_ids);

DELETE FROM odoo_invoice_lines WHERE odoo_company_id <> 1;

DELETE FROM odoo_invoices WHERE odoo_company_id <> 1;

DELETE FROM odoo_deliveries WHERE odoo_company_id <> 1;

INSERT INTO pipeline_logs (level, phase, message, details)
VALUES (
  'info',
  'cleanup_odoo_multicompany_contamination',
  'Removed odoo_company_id != 1 contamination: 524 invoices + 506 canonical + 1 delivery. These belong to Mizrahi family Odoo companies (2/3/4), not Quimibond.',
  jsonb_build_object(
    'odoo_invoices_deleted', 524,
    'canonical_invoices_deleted', 506,
    'odoo_deliveries_deleted', 1,
    'real_quimibond_company_id', 1,
    'next_action_external', 'modify Odoo connector sync to filter company_id=1 in origin'
  )
);

COMMIT;
