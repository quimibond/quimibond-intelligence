-- SP2 Task 03b: Correct has_sat_record flag on rows with no actual SAT payload
--
-- Why: 3,433 rows in canonical_invoices got has_sat_record=true during Task 2's
-- preliminary seeding (because their cfdi_uuid_odoo IS NOT NULL), but Task 3
-- found their UUIDs either (a) don't exist anywhere in syntage_invoices, or
-- (b) match a non-'I' tipo (P/E/N) complement. Without this patch, Task 15's
-- `invoice.missing_sat_timbrado` invariant silently suppresses medium-severity
-- alerts on these rows (evaluates "SAT arrived" when SAT payload is absent).
--
-- Secondary correction: completeness_score was computed as 0.667 for these rows
-- (assuming both odoo+sat present). Actual value should be 0.333 (odoo only).
--
-- Scope: ~3,433 rows. Does NOT touch the 25,004 legitimate dual-source rows.

BEGIN;

UPDATE canonical_invoices
SET
  has_sat_record = false,
  sources_present = array_remove(sources_present, 'sat'),
  completeness_score = CASE
    WHEN has_odoo_record THEN 0.333
    ELSE 0.000
  END,
  sources_missing = CASE
    WHEN has_odoo_record THEN ARRAY['sat', 'email']
    ELSE ARRAY['odoo', 'sat', 'email']
  END
WHERE has_sat_record = true
  AND tipo_comprobante_sat IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM syntage_invoices si
    WHERE si.uuid = cfdi_uuid_odoo
      AND si.tipo_comprobante = 'I'
  );

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('patch','canonical_invoices',
  'SP2 Task 03b: correct has_sat_record=true on rows with no SAT tipo=I payload',
  '20260422_sp2_03b_correct_has_sat_record.sql','silver-sp2',true);

COMMIT;
