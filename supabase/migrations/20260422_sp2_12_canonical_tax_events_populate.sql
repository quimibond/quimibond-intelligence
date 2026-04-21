BEGIN;

-- ====================================================================
-- 12a. Retentions
-- ====================================================================
INSERT INTO canonical_tax_events (
  canonical_id, event_type, sat_record_id,
  retention_uuid, tipo_retencion, monto_total_retenido,
  emisor_rfc, receptor_rfc, retention_fecha_emision, sat_estado,
  taxpayer_rfc, source_hashes
)
SELECT
  'retention:' || COALESCE(r.uuid, r.syntage_id),
  'retention',
  r.syntage_id,
  r.uuid, r.tipo_retencion, r.monto_total_retenido,
  r.emisor_rfc, r.receptor_rfc, r.fecha_emision, r.estado_sat,
  COALESCE(r.taxpayer_rfc, 'PNT920218IW5'),
  jsonb_build_object('sat_synced_at', r.synced_at)
FROM syntage_tax_retentions r
ON CONFLICT (canonical_id) DO NOTHING;

-- ====================================================================
-- 12b. Tax returns
-- ====================================================================
INSERT INTO canonical_tax_events (
  canonical_id, event_type, sat_record_id,
  return_ejercicio, return_periodo, return_impuesto,
  return_tipo_declaracion, return_fecha_presentacion, return_monto_pagado, return_numero_operacion,
  taxpayer_rfc, source_hashes
)
SELECT
  'return:' || r.ejercicio || '-' || COALESCE(r.periodo,'X') || '-' || COALESCE(r.impuesto,'X') || '-' || r.syntage_id,
  'tax_return',
  r.syntage_id,
  r.ejercicio, r.periodo, r.impuesto,
  r.tipo_declaracion, r.fecha_presentacion, r.monto_pagado, r.numero_operacion,
  COALESCE(r.taxpayer_rfc, 'PNT920218IW5'),
  jsonb_build_object('sat_synced_at', r.synced_at)
FROM syntage_tax_returns r
ON CONFLICT (canonical_id) DO NOTHING;

-- ====================================================================
-- 12c. Electronic accounting
-- ====================================================================
INSERT INTO canonical_tax_events (
  canonical_id, event_type, sat_record_id,
  acct_ejercicio, acct_periodo, acct_record_type, acct_tipo_envio, acct_hash,
  taxpayer_rfc, source_hashes
)
SELECT
  'acct:' || e.ejercicio || '-' || COALESCE(e.periodo,'X') || '-' || COALESCE(e.record_type,'X') || '-' || e.syntage_id,
  'electronic_accounting',
  e.syntage_id,
  e.ejercicio, e.periodo, e.record_type, e.tipo_envio, e.hash,
  COALESCE(e.taxpayer_rfc, 'PNT920218IW5'),
  jsonb_build_object('sat_synced_at', e.synced_at)
FROM syntage_electronic_accounting e
ON CONFLICT (canonical_id) DO NOTHING;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('populate','canonical_tax_events','SP2 Task 12: populate SAT sources','20260422_sp2_12_canonical_tax_events_populate.sql','silver-sp2',true);

COMMIT;
