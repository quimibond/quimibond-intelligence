-- Deprecate el invariant tax.retention_accounting_drift por defectos estructurales:
--
-- BUG #1: filtro 'tipo_retencion ILIKE %ISR%' nunca matchea porque los códigos
--   SAT son numéricos ('01','08','11','14','16'), no contienen el string "ISR".
--   Resultado: sat_total siempre = 0 → diff = odoo_total siempre.
--
-- BUG #2: incluso con fix del filtro, las cuentas Odoo 113.%/213.% mezclan
--   ISR + IVA + otras retenciones. Sumar amount_retenciones_sat de canonical
--   _invoices (que es lo correcto del lado SAT) tampoco cuadraría sin
--   granularizar las cuentas Odoo a solo ISR.
--
-- BUG #3: comparación mensual asume timing fiscal=contable, pero el ISR se
--   acumula contablemente al momento del CFDI y se paga fiscalmente al mes
--   siguiente. Drift "real" lo provoca el cycling natural.
--
-- Decisión: cheaper retire than redesign (mismo patrón que
-- invoice.without_order, payment.complement_without_payment). Reescribir
-- requiere conocimiento fiscal específico (mapping cuenta Odoo → código SAT
-- exacto) y diseño de timing fiscal vs contable. Re-enable si en el futuro
-- llega ese conocimiento dominio.

BEGIN;

UPDATE audit_tolerances
SET enabled = false,
    notes = COALESCE(notes,'') || E'\n\nDEPRECATED 2026-04-29: filtro tipo_retencion ILIKE %ISR% nunca matchea (códigos SAT son numéricos). Cuentas 113/213 mezclan ISR+IVA+otros. Reescribir requiere conocimiento fiscal específico. Ver migración deprecate_tax_retention_accounting_drift.'
WHERE invariant_key = 'tax.retention_accounting_drift';

UPDATE reconciliation_issues
SET resolved_at = now(),
    resolution = 'auto_invariant_design_flaw',
    resolution_note = 'Invariant deprecated: tipo_retencion ILIKE %ISR% never matches numeric SAT codes; Odoo 113/213 accounts conflate ISR+IVA+others.'
WHERE invariant_key = 'tax.retention_accounting_drift'
  AND resolved_at IS NULL;

INSERT INTO pipeline_logs (level, phase, message, details)
VALUES (
  'info',
  'deprecate_tax_retention_accounting_drift',
  'Deprecated tax.retention_accounting_drift invariant (52 issues, $30.7M MXN). Filter tipo_retencion ILIKE %ISR% never matched numeric SAT codes; account mapping was conflated. Cheaper retire than redesign.',
  jsonb_build_object(
    'issues_auto_resolved', 52,
    'total_impact_mxn_cleared', 30740000,
    'reactivate_if', 'fiscal domain expert provides correct ISR-only Odoo account mapping + SAT code list'
  )
);

COMMIT;
