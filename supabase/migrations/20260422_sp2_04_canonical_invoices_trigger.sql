BEGIN;

-- =========================================
-- Odoo-side upsert trigger
-- =========================================
CREATE OR REPLACE FUNCTION canonical_invoices_upsert_from_odoo() RETURNS trigger AS $$
DECLARE
  v_canonical_id text;
BEGIN
  IF NEW.move_type NOT IN ('out_invoice','in_invoice') THEN
    RETURN NEW;  -- refunds go to canonical_credit_notes trigger (Task 10)
  END IF;

  -- If Odoo has cfdi_uuid and an existing canonical row uses that sat_uuid, reuse its canonical_id (consolidation).
  IF NEW.cfdi_uuid IS NOT NULL AND EXISTS(SELECT 1 FROM canonical_invoices WHERE sat_uuid=NEW.cfdi_uuid) THEN
    v_canonical_id := (SELECT canonical_id FROM canonical_invoices WHERE sat_uuid=NEW.cfdi_uuid LIMIT 1);
  ELSE
    v_canonical_id := 'odoo:' || NEW.id::text;
  END IF;

  INSERT INTO canonical_invoices (
    canonical_id, odoo_invoice_id, sat_uuid,
    direction, move_type_odoo,
    amount_total_odoo, amount_untaxed_odoo, amount_tax_odoo, amount_residual_odoo,
    amount_paid_odoo, amount_total_mxn_odoo, amount_total_mxn_ops, amount_residual_mxn_odoo,
    currency_odoo, invoice_date, due_date_odoo, payment_date_odoo,
    state_odoo, payment_state_odoo, cfdi_sat_state_odoo, edi_state_odoo,
    odoo_name, cfdi_uuid_odoo, odoo_ref, odoo_partner_id,
    payment_term_odoo, salesperson_user_id,
    emisor_company_id, receptor_company_id,
    has_odoo_record, sources_present, source_hashes
  ) VALUES (
    v_canonical_id, NEW.id, NEW.cfdi_uuid,
    CASE NEW.move_type WHEN 'out_invoice' THEN 'issued' WHEN 'in_invoice' THEN 'received' END,
    NEW.move_type,
    NEW.amount_total, NEW.amount_untaxed, NEW.amount_tax, NEW.amount_residual,
    NEW.amount_paid, NEW.amount_total_mxn, NEW.amount_total_mxn, NEW.amount_residual_mxn,
    NEW.currency, NEW.invoice_date, NEW.due_date, NEW.payment_date,
    NEW.state, NEW.payment_state, NEW.cfdi_sat_state, NEW.edi_state,
    NEW.name, NEW.cfdi_uuid, NEW.ref, NEW.odoo_partner_id,
    NEW.payment_term, NEW.salesperson_user_id,
    -- Quimibond = companies.id=6707 (SP3 MDM will revise to canonical_companies FK)
    CASE WHEN NEW.move_type = 'out_invoice' THEN 6707 ELSE NEW.company_id END,
    CASE WHEN NEW.move_type = 'in_invoice'  THEN 6707 ELSE NEW.company_id END,
    true,
    ARRAY['odoo'],
    jsonb_build_object('odoo_write_date', NEW.write_date, 'odoo_synced_at', NEW.synced_at)
  )
  ON CONFLICT (canonical_id) DO UPDATE SET
    odoo_invoice_id = EXCLUDED.odoo_invoice_id,
    sat_uuid = COALESCE(canonical_invoices.sat_uuid, EXCLUDED.sat_uuid),
    move_type_odoo = EXCLUDED.move_type_odoo,
    amount_total_odoo = EXCLUDED.amount_total_odoo,
    amount_untaxed_odoo = EXCLUDED.amount_untaxed_odoo,
    amount_tax_odoo = EXCLUDED.amount_tax_odoo,
    amount_residual_odoo = EXCLUDED.amount_residual_odoo,
    amount_paid_odoo = EXCLUDED.amount_paid_odoo,
    amount_total_mxn_odoo = EXCLUDED.amount_total_mxn_odoo,
    amount_total_mxn_ops = EXCLUDED.amount_total_mxn_odoo,
    amount_residual_mxn_odoo = EXCLUDED.amount_residual_mxn_odoo,
    currency_odoo = EXCLUDED.currency_odoo,
    invoice_date = EXCLUDED.invoice_date,
    due_date_odoo = EXCLUDED.due_date_odoo,
    payment_date_odoo = EXCLUDED.payment_date_odoo,
    state_odoo = EXCLUDED.state_odoo,
    payment_state_odoo = EXCLUDED.payment_state_odoo,
    cfdi_sat_state_odoo = EXCLUDED.cfdi_sat_state_odoo,
    edi_state_odoo = EXCLUDED.edi_state_odoo,
    odoo_name = EXCLUDED.odoo_name,
    cfdi_uuid_odoo = EXCLUDED.cfdi_uuid_odoo,
    odoo_ref = EXCLUDED.odoo_ref,
    odoo_partner_id = EXCLUDED.odoo_partner_id,
    payment_term_odoo = EXCLUDED.payment_term_odoo,
    salesperson_user_id = EXCLUDED.salesperson_user_id,
    emisor_company_id = COALESCE(canonical_invoices.emisor_company_id, EXCLUDED.emisor_company_id),
    receptor_company_id = COALESCE(canonical_invoices.receptor_company_id, EXCLUDED.receptor_company_id),
    has_odoo_record = true,
    sources_present = ARRAY(SELECT DISTINCT unnest(canonical_invoices.sources_present || ARRAY['odoo'])),
    source_hashes = COALESCE(canonical_invoices.source_hashes,'{}'::jsonb)
                    || jsonb_build_object('odoo_write_date', NEW.write_date, 'odoo_synced_at', NEW.synced_at);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =========================================
-- SAT-side upsert trigger (tipo='I' only)
-- =========================================
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
    -- syntage_invoices.direction is already English ('issued'/'received') — pass through directly
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

DROP TRIGGER IF EXISTS trg_canonical_invoices_from_odoo ON odoo_invoices;
CREATE TRIGGER trg_canonical_invoices_from_odoo
  AFTER INSERT OR UPDATE ON odoo_invoices
  FOR EACH ROW EXECUTE FUNCTION canonical_invoices_upsert_from_odoo();

DROP TRIGGER IF EXISTS trg_canonical_invoices_from_sat ON syntage_invoices;
CREATE TRIGGER trg_canonical_invoices_from_sat
  AFTER INSERT OR UPDATE ON syntage_invoices
  FOR EACH ROW EXECUTE FUNCTION canonical_invoices_upsert_from_sat();

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_trigger','canonical_invoices','SP2 Task 4: incremental upsert triggers (Odoo+SAT), Quimibond=6707, symmetric sat_uuid collision check','20260422_sp2_04_canonical_invoices_trigger.sql','silver-sp2',true);

COMMIT;
