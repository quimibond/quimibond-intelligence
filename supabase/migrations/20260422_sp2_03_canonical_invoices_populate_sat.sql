-- SP2 Task 3: Populate canonical_invoices SAT side + composite match fallback
-- Applied 2026-04-22 via batched execute_sql (apply_migration timed out on full migration)
-- Steps: 3a (direct uuid match) + 3b (composite match, ~19 batches of 500-3000)
--        + 3c (SAT fields for new matches) + 3d (SAT-only inserts) + 3e (completeness_score)
--
-- NOTES:
-- - apply_migration timed out for the full migration AND for 3a alone → used execute_sql
-- - 3b composite match had unique constraint violations (one SAT UUID → many Odoo rows);
--   fixed by adding DISTINCT ON deduplication (best match per syntage_uuid, then per odoo_invoice_id)
--   AND an additional NOT EXISTS filter excluding already-assigned sat_uuids
-- - 3b ran in ~19 incremental batches (500–3000 rows) until convergence at 6,912 matches
--
-- Final results (verified):
--   total=88443, dual=25004, odoo_only=2175, sat_only=61264
--   historical=46563, pending_op=14701
--   % UUID post-2021 = 95.27% (DoD: ≥95% PASS)
--   composite_match high=5595, medium=1317 (total=6912)
--   0 canonical_id collisions, 0 orphan records
--   amount discrepant=7, max_diff=17748, avg_diff=2.09

-- ===== STEP 3a: UPDATE canonical rows with sat_uuid already matched =====
-- (seeded from Odoo cfdi_uuid in Task 2 → 18,104 rows; 14,309 matched to syntage tipo='I')
UPDATE canonical_invoices ci
SET
  tipo_comprobante_sat = si.tipo_comprobante,
  amount_total_sat = si.total,
  amount_untaxed_sat = si.subtotal,
  amount_tax_sat = si.impuestos_trasladados,
  amount_retenciones_sat = si.impuestos_retenidos,
  amount_total_mxn_sat = si.total_mxn,
  amount_total_mxn_fiscal = si.total_mxn,
  currency_sat = si.moneda,
  tipo_cambio_sat = si.tipo_cambio,
  fecha_emision = si.fecha_emision,
  fecha_timbrado = si.fecha_timbrado,
  fecha_cancelacion = si.fecha_cancelacion,
  estado_sat = si.estado_sat,
  serie = COALESCE(ci.serie, si.serie),
  folio = COALESCE(ci.folio, si.folio),
  emisor_rfc = si.emisor_rfc,
  emisor_nombre = si.emisor_nombre,
  receptor_rfc = si.receptor_rfc,
  receptor_nombre = si.receptor_nombre,
  emisor_blacklist_status = si.emisor_blacklist_status,
  receptor_blacklist_status = si.receptor_blacklist_status,
  metodo_pago = si.metodo_pago,
  forma_pago = si.forma_pago,
  uso_cfdi = si.uso_cfdi,
  has_sat_record = true,
  sources_present = ARRAY(SELECT DISTINCT unnest(ci.sources_present || ARRAY['sat'])),
  source_hashes = COALESCE(ci.source_hashes,'{}'::jsonb) || jsonb_build_object('sat_synced_at', si.synced_at)
FROM syntage_invoices si
WHERE si.uuid = ci.sat_uuid
  AND si.tipo_comprobante='I';

-- ===== STEP 3b: Composite match (template — was run in batches) =====
-- Run multiple times with p_batch_size=500-3000 until convergence.
-- Added deduplication and NOT EXISTS guard to prevent unique constraint violations.
-- Template (idempotent — safe to re-run):
WITH raw_matches AS (
  SELECT odoo_invoice_id, syntage_uuid, match_confidence
  FROM match_unlinked_invoices_by_composite(p_batch_size := 500, p_date_tolerance_days := 3, p_amount_tolerance := 0.01)
  WHERE match_confidence IN ('high','medium')
    AND NOT EXISTS (SELECT 1 FROM canonical_invoices ci2 WHERE ci2.sat_uuid = syntage_uuid)
),
deduped AS (
  SELECT DISTINCT ON (syntage_uuid)
    odoo_invoice_id, syntage_uuid, match_confidence
  FROM raw_matches
  ORDER BY syntage_uuid,
    CASE match_confidence WHEN 'high' THEN 1 ELSE 2 END,
    odoo_invoice_id
),
final_matches AS (
  SELECT DISTINCT ON (odoo_invoice_id)
    odoo_invoice_id, syntage_uuid, match_confidence
  FROM deduped
  ORDER BY odoo_invoice_id,
    CASE match_confidence WHEN 'high' THEN 1 ELSE 2 END
)
UPDATE canonical_invoices ci
SET
  sat_uuid = m.syntage_uuid,
  resolved_from = 'sat_composite_match',
  match_confidence = m.match_confidence,
  match_evidence = jsonb_build_object(
    'method','composite',
    'inputs', jsonb_build_object(
      'tolerance_days', 3,
      'tolerance_amount', 0.01
    )
  )
FROM final_matches m
WHERE ci.odoo_invoice_id = m.odoo_invoice_id
  AND ci.sat_uuid IS NULL;

-- ===== STEP 3c: Pull SAT fields for newly-matched rows =====
UPDATE canonical_invoices ci
SET
  tipo_comprobante_sat = si.tipo_comprobante,
  amount_total_sat = si.total,
  amount_untaxed_sat = si.subtotal,
  amount_tax_sat = si.impuestos_trasladados,
  amount_retenciones_sat = si.impuestos_retenidos,
  amount_total_mxn_sat = si.total_mxn,
  amount_total_mxn_fiscal = si.total_mxn,
  currency_sat = si.moneda,
  tipo_cambio_sat = si.tipo_cambio,
  fecha_emision = si.fecha_emision,
  fecha_timbrado = si.fecha_timbrado,
  fecha_cancelacion = si.fecha_cancelacion,
  estado_sat = si.estado_sat,
  emisor_rfc = COALESCE(ci.emisor_rfc, si.emisor_rfc),
  emisor_nombre = COALESCE(ci.emisor_nombre, si.emisor_nombre),
  receptor_rfc = COALESCE(ci.receptor_rfc, si.receptor_rfc),
  receptor_nombre = COALESCE(ci.receptor_nombre, si.receptor_nombre),
  emisor_blacklist_status = si.emisor_blacklist_status,
  receptor_blacklist_status = si.receptor_blacklist_status,
  metodo_pago = si.metodo_pago,
  forma_pago = si.forma_pago,
  uso_cfdi = si.uso_cfdi,
  has_sat_record = true,
  sources_present = ARRAY(SELECT DISTINCT unnest(ci.sources_present || ARRAY['sat']))
FROM syntage_invoices si
WHERE si.uuid = ci.sat_uuid
  AND si.tipo_comprobante='I'
  AND ci.has_sat_record = false;

-- ===== STEP 3d: Insert SAT-only rows =====
INSERT INTO canonical_invoices (
  canonical_id, sat_uuid, direction, tipo_comprobante_sat,
  amount_total_sat, amount_untaxed_sat, amount_tax_sat, amount_retenciones_sat,
  amount_total_mxn_sat, amount_total_mxn_fiscal,
  currency_sat, tipo_cambio_sat,
  fecha_emision, fecha_timbrado, fecha_cancelacion, estado_sat,
  serie, folio,
  emisor_rfc, emisor_nombre, receptor_rfc, receptor_nombre,
  emisor_blacklist_status, receptor_blacklist_status,
  metodo_pago, forma_pago, uso_cfdi,
  has_odoo_record, has_sat_record, sources_present,
  resolved_from, match_confidence, source_hashes
)
SELECT
  si.uuid AS canonical_id,
  si.uuid AS sat_uuid,
  CASE si.direction WHEN 'emitida' THEN 'issued' WHEN 'recibida' THEN 'received' ELSE 'internal' END,
  si.tipo_comprobante,
  si.total, si.subtotal, si.impuestos_trasladados, si.impuestos_retenidos,
  si.total_mxn, si.total_mxn,
  si.moneda, si.tipo_cambio,
  si.fecha_emision, si.fecha_timbrado, si.fecha_cancelacion, si.estado_sat,
  si.serie, si.folio,
  si.emisor_rfc, si.emisor_nombre, si.receptor_rfc, si.receptor_nombre,
  si.emisor_blacklist_status, si.receptor_blacklist_status,
  si.metodo_pago, si.forma_pago, si.uso_cfdi,
  false, true, ARRAY['sat'],
  'sat_primary', 'exact',
  jsonb_build_object('sat_synced_at', si.synced_at)
FROM syntage_invoices si
WHERE si.tipo_comprobante='I'
  AND NOT EXISTS (SELECT 1 FROM canonical_invoices ci WHERE ci.sat_uuid = si.uuid)
ON CONFLICT (canonical_id) DO NOTHING;

-- ===== STEP 3e: Compute completeness_score + sources_missing =====
UPDATE canonical_invoices ci
SET
  completeness_score = CASE
    WHEN has_odoo_record AND has_sat_record AND has_email_thread THEN 1.000
    WHEN has_odoo_record AND has_sat_record THEN 0.667
    WHEN has_odoo_record OR has_sat_record THEN 0.333
    ELSE 0.000
  END,
  sources_missing = CASE
    WHEN has_odoo_record AND has_sat_record THEN ARRAY['email']
    WHEN has_odoo_record AND NOT has_sat_record THEN ARRAY['sat','email']
    WHEN NOT has_odoo_record AND has_sat_record THEN ARRAY['odoo','email']
    ELSE ARRAY['odoo','sat','email']
  END
WHERE completeness_score IS NULL OR sources_missing = '{}';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('populate','canonical_invoices','SP2 Task 3: merge SAT + composite match (batched via execute_sql)','20260422_sp2_03_canonical_invoices_populate_sat.sql','silver-sp2',true);
