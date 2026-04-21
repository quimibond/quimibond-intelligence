BEGIN;

-- ====================================================================
-- Odoo-side upsert trigger (refunds only)
-- ====================================================================
CREATE OR REPLACE FUNCTION canonical_credit_notes_upsert_from_odoo() RETURNS trigger AS $$
DECLARE
  v_canonical_id text;
BEGIN
  IF NEW.move_type NOT IN ('out_refund','in_refund') THEN RETURN NEW; END IF;

  IF NEW.cfdi_uuid IS NOT NULL AND EXISTS(SELECT 1 FROM canonical_credit_notes WHERE sat_uuid=NEW.cfdi_uuid) THEN
    v_canonical_id := (SELECT canonical_id FROM canonical_credit_notes WHERE sat_uuid=NEW.cfdi_uuid LIMIT 1);
  ELSE
    v_canonical_id := COALESCE(NEW.cfdi_uuid, 'odoo:' || NEW.id::text);
  END IF;

  INSERT INTO canonical_credit_notes (
    canonical_id, odoo_invoice_id, sat_uuid, direction, move_type_odoo,
    amount_total_odoo, amount_total_mxn_odoo, currency_odoo, invoice_date,
    odoo_partner_id, state_odoo,
    emisor_company_id, receptor_company_id,
    has_odoo_record, sources_present, source_hashes
  ) VALUES (
    v_canonical_id, NEW.id, NEW.cfdi_uuid,
    CASE WHEN NEW.move_type='out_refund' THEN 'issued' ELSE 'received' END,
    NEW.move_type,
    NEW.amount_total, NEW.amount_total_mxn, NEW.currency, NEW.invoice_date,
    NEW.odoo_partner_id, NEW.state,
    CASE WHEN NEW.move_type='out_refund' THEN 6707 ELSE NEW.company_id END,
    CASE WHEN NEW.move_type='in_refund'  THEN 6707 ELSE NEW.company_id END,
    true, ARRAY['odoo'],
    jsonb_build_object('odoo_write_date', NEW.write_date, 'odoo_synced_at', NEW.synced_at)
  )
  ON CONFLICT (canonical_id) DO UPDATE SET
    odoo_invoice_id = EXCLUDED.odoo_invoice_id,
    sat_uuid = COALESCE(canonical_credit_notes.sat_uuid, EXCLUDED.sat_uuid),
    move_type_odoo = EXCLUDED.move_type_odoo,
    amount_total_odoo = EXCLUDED.amount_total_odoo,
    amount_total_mxn_odoo = EXCLUDED.amount_total_mxn_odoo,
    currency_odoo = EXCLUDED.currency_odoo,
    invoice_date = EXCLUDED.invoice_date,
    odoo_partner_id = EXCLUDED.odoo_partner_id,
    state_odoo = EXCLUDED.state_odoo,
    emisor_company_id = COALESCE(canonical_credit_notes.emisor_company_id, EXCLUDED.emisor_company_id),
    receptor_company_id = COALESCE(canonical_credit_notes.receptor_company_id, EXCLUDED.receptor_company_id),
    has_odoo_record = true,
    sources_present = ARRAY(SELECT DISTINCT unnest(canonical_credit_notes.sources_present || ARRAY['odoo'])),
    source_hashes = COALESCE(canonical_credit_notes.source_hashes, '{}'::jsonb)
                    || jsonb_build_object('odoo_write_date', NEW.write_date, 'odoo_synced_at', NEW.synced_at);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ====================================================================
-- SAT-side upsert trigger (tipo='E' only)
-- ====================================================================
CREATE OR REPLACE FUNCTION canonical_credit_notes_upsert_from_sat() RETURNS trigger AS $$
DECLARE
  v_canonical_id text;
  v_related_uuid text;
BEGIN
  IF NEW.tipo_comprobante <> 'E' THEN RETURN NEW; END IF;

  -- Symmetric collision check: if an Odoo-seeded row claimed this uuid already, reuse.
  IF EXISTS(SELECT 1 FROM canonical_credit_notes WHERE sat_uuid=NEW.uuid) THEN
    v_canonical_id := (SELECT canonical_id FROM canonical_credit_notes WHERE sat_uuid=NEW.uuid LIMIT 1);
  ELSE
    v_canonical_id := NEW.uuid;
  END IF;

  v_related_uuid := NEW.raw_payload #>> '{relations,0,relatedInvoiceUuid}';

  INSERT INTO canonical_credit_notes (
    canonical_id, sat_uuid, direction, tipo_comprobante_sat,
    amount_total_sat, amount_total_mxn_sat, currency_sat, tipo_cambio_sat,
    fecha_emision, fecha_timbrado, fecha_cancelacion, estado_sat,
    emisor_rfc, emisor_nombre, receptor_rfc, receptor_nombre,
    related_invoice_uuid, tipo_relacion,
    has_sat_record, sources_present, source_hashes
  ) VALUES (
    v_canonical_id, NEW.uuid,
    NEW.direction,  -- English native; matches canonical_credit_notes.direction CHECK
    NEW.tipo_comprobante,
    NEW.total, NEW.total_mxn, NEW.moneda, NEW.tipo_cambio,
    NEW.fecha_emision, NEW.fecha_timbrado, NEW.fecha_cancelacion, NEW.estado_sat,
    NEW.emisor_rfc, NEW.emisor_nombre, NEW.receptor_rfc, NEW.receptor_nombre,
    v_related_uuid,
    (NEW.raw_payload #>> '{relations,0,type}'),
    true, ARRAY['sat'],
    jsonb_build_object('sat_synced_at', NEW.synced_at)
  )
  ON CONFLICT (canonical_id) DO UPDATE SET
    amount_total_sat = EXCLUDED.amount_total_sat,
    amount_total_mxn_sat = EXCLUDED.amount_total_mxn_sat,
    fecha_emision = EXCLUDED.fecha_emision,
    fecha_timbrado = EXCLUDED.fecha_timbrado,
    fecha_cancelacion = EXCLUDED.fecha_cancelacion,
    estado_sat = EXCLUDED.estado_sat,
    related_invoice_uuid = EXCLUDED.related_invoice_uuid,
    tipo_relacion = EXCLUDED.tipo_relacion,
    has_sat_record = true,
    sources_present = ARRAY(SELECT DISTINCT unnest(canonical_credit_notes.sources_present || ARRAY['sat']));

  -- Resolve related_invoice_canonical_id via canonical_invoices lookup
  IF v_related_uuid IS NOT NULL THEN
    UPDATE canonical_credit_notes ccn
    SET related_invoice_canonical_id = ci.canonical_id
    FROM canonical_invoices ci
    WHERE ccn.canonical_id = v_canonical_id
      AND ci.sat_uuid = v_related_uuid
      AND ccn.related_invoice_canonical_id IS NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ccn_from_odoo ON odoo_invoices;
CREATE TRIGGER trg_ccn_from_odoo AFTER INSERT OR UPDATE ON odoo_invoices
  FOR EACH ROW EXECUTE FUNCTION canonical_credit_notes_upsert_from_odoo();

DROP TRIGGER IF EXISTS trg_ccn_from_sat ON syntage_invoices;
CREATE TRIGGER trg_ccn_from_sat AFTER INSERT OR UPDATE ON syntage_invoices
  FOR EACH ROW EXECUTE FUNCTION canonical_credit_notes_upsert_from_sat();

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_trigger','canonical_credit_notes','SP2 Task 10: incremental triggers (refunds/E) with relations jsonb keys','20260422_sp2_10_canonical_credit_notes_trigger.sql','silver-sp2',true);

COMMIT;
