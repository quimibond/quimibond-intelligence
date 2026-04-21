-- Fix: syntage_invoices.direction is already in English ('issued'/'received'),
-- not Spanish ('emitida'/'recibida'). Pass through directly.
-- This replaces the CASE expression from the initial Task 4 function.
CREATE OR REPLACE FUNCTION canonical_invoices_upsert_from_sat() RETURNS trigger AS $$
DECLARE
  v_canonical_id text;
BEGIN
  IF NEW.tipo_comprobante <> 'I' THEN RETURN NEW; END IF;

  -- If an existing row already uses this UUID as sat_uuid (seeded from Odoo cfdi_uuid or prior SAT sync),
  -- reuse that canonical_id instead of trying to create a new row (avoids uq_canonical_invoices_sat_uuid violation).
  IF EXISTS(SELECT 1 FROM canonical_invoices WHERE sat_uuid = NEW.uuid AND canonical_id <> NEW.uuid) THEN
    v_canonical_id := (SELECT canonical_id FROM canonical_invoices WHERE sat_uuid = NEW.uuid LIMIT 1);
  ELSE
    v_canonical_id := NEW.uuid;
  END IF;

  INSERT INTO canonical_invoices (
    canonical_id, sat_uuid,
    direction, tipo_comprobante_sat,
    amount_total_sat, amount_untaxed_sat, amount_tax_sat, amount_retenciones_sat,
    amount_total_mxn_sat, amount_total_mxn_fiscal,
    currency_sat, tipo_cambio_sat,
    fecha_emision, fecha_timbrado, fecha_cancelacion, estado_sat,
    serie, folio,
    emisor_rfc, emisor_nombre, receptor_rfc, receptor_nombre,
    emisor_blacklist_status, receptor_blacklist_status,
    metodo_pago, forma_pago, uso_cfdi,
    has_sat_record, sources_present,
    resolved_from, match_confidence,
    source_hashes
  ) VALUES (
    v_canonical_id, NEW.uuid,
    -- syntage_invoices.direction is already English ('issued'/'received')
    NEW.direction,
    NEW.tipo_comprobante,
    NEW.total, NEW.subtotal, NEW.impuestos_trasladados, NEW.impuestos_retenidos,
    NEW.total_mxn, NEW.total_mxn,
    NEW.moneda, NEW.tipo_cambio,
    NEW.fecha_emision, NEW.fecha_timbrado, NEW.fecha_cancelacion, NEW.estado_sat,
    NEW.serie, NEW.folio,
    NEW.emisor_rfc, NEW.emisor_nombre, NEW.receptor_rfc, NEW.receptor_nombre,
    NEW.emisor_blacklist_status, NEW.receptor_blacklist_status,
    NEW.metodo_pago, NEW.forma_pago, NEW.uso_cfdi,
    true, ARRAY['sat'],
    'sat_primary', 'exact',
    jsonb_build_object('sat_synced_at', NEW.synced_at)
  )
  ON CONFLICT (canonical_id) DO UPDATE SET
    sat_uuid = EXCLUDED.sat_uuid,
    tipo_comprobante_sat = EXCLUDED.tipo_comprobante_sat,
    amount_total_sat = EXCLUDED.amount_total_sat,
    amount_untaxed_sat = EXCLUDED.amount_untaxed_sat,
    amount_tax_sat = EXCLUDED.amount_tax_sat,
    amount_retenciones_sat = EXCLUDED.amount_retenciones_sat,
    amount_total_mxn_sat = EXCLUDED.amount_total_mxn_sat,
    amount_total_mxn_fiscal = EXCLUDED.amount_total_mxn_sat,
    currency_sat = EXCLUDED.currency_sat,
    tipo_cambio_sat = EXCLUDED.tipo_cambio_sat,
    fecha_emision = EXCLUDED.fecha_emision,
    fecha_timbrado = EXCLUDED.fecha_timbrado,
    fecha_cancelacion = EXCLUDED.fecha_cancelacion,
    estado_sat = EXCLUDED.estado_sat,
    emisor_rfc = COALESCE(canonical_invoices.emisor_rfc, EXCLUDED.emisor_rfc),
    emisor_nombre = COALESCE(canonical_invoices.emisor_nombre, EXCLUDED.emisor_nombre),
    receptor_rfc = COALESCE(canonical_invoices.receptor_rfc, EXCLUDED.receptor_rfc),
    receptor_nombre = COALESCE(canonical_invoices.receptor_nombre, EXCLUDED.receptor_nombre),
    emisor_blacklist_status = EXCLUDED.emisor_blacklist_status,
    receptor_blacklist_status = EXCLUDED.receptor_blacklist_status,
    metodo_pago = EXCLUDED.metodo_pago,
    forma_pago = EXCLUDED.forma_pago,
    uso_cfdi = EXCLUDED.uso_cfdi,
    has_sat_record = true,
    sources_present = ARRAY(SELECT DISTINCT unnest(canonical_invoices.sources_present || ARRAY['sat'])),
    source_hashes = COALESCE(canonical_invoices.source_hashes,'{}'::jsonb)
                    || jsonb_build_object('sat_synced_at', NEW.synced_at);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('alter_function','canonical_invoices','SP2 Task 4b: fix sat direction CASE — syntage_invoices.direction is already English','20260422_sp2_04b_fix_sat_direction_case.sql','silver-sp2',true);
