-- SP2 Task 04c: Fix 61,264 canonical_invoices rows with incorrect direction='internal'
--
-- Root cause: Task 3 Step 3d populate SQL (and Task 4 pre-fix trigger) used
-- `CASE si.direction WHEN 'emitida' THEN 'issued' WHEN 'recibida' THEN 'received' ELSE 'internal' END`.
-- But `syntage_invoices.direction` stores English values ('issued' / 'received') natively — the
-- Spanish CASE labels never matched, so every SAT-side INSERT fell through to 'internal'.
--
-- Task 04b fixed the Task 4 trigger. This patch corrects the 61,264 already-populated rows.
--
-- Scope: 61,264 rows where resolved_from='sat_primary' AND direction='internal'.
-- Verification: after update, 'internal' count should drop to near-zero (only rare edge cases).

BEGIN;

UPDATE canonical_invoices ci
SET direction = si.direction
FROM syntage_invoices si
WHERE ci.sat_uuid = si.uuid
  AND si.tipo_comprobante = 'I'
  AND ci.direction = 'internal'
  AND si.direction IN ('issued','received');

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('patch','canonical_invoices',
  'SP2 Task 04c: correct direction=internal on 61,264 sat_primary rows (Spanish/English mismatch)',
  '20260422_sp2_04c_fix_direction_internal_on_sat_rows.sql','silver-sp2',true);

COMMIT;
