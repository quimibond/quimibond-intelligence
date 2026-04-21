BEGIN;

-- ====================================================================
-- Odoo-side upsert trigger
-- ====================================================================
CREATE OR REPLACE FUNCTION canonical_payments_upsert_from_odoo() RETURNS trigger AS $$
DECLARE
  v_canonical_id text;
BEGIN
  -- If a SAT row already has num_operacion match, use that canonical (consolidation).
  -- Note: num_operacion bridge is dead in 2026-04-22 data (99.9% nulls both sides);
  -- kept future-proof; matches 0 rows in current data.
  IF NEW.ref IS NOT NULL AND NEW.ref <> '' AND EXISTS(
    SELECT 1 FROM canonical_payments cp
    WHERE cp.num_operacion = NEW.ref
      AND cp.num_operacion IS NOT NULL AND cp.num_operacion <> ''
      AND cp.amount_sat IS NOT NULL
      AND ABS(cp.amount_sat - NEW.amount) < 0.01
      AND cp.fecha_pago_sat IS NOT NULL
      AND ABS(cp.fecha_pago_sat::date - NEW.date) <= 1
  ) THEN
    v_canonical_id := (
      SELECT cp.canonical_id FROM canonical_payments cp
      WHERE cp.num_operacion = NEW.ref
        AND ABS(cp.amount_sat - NEW.amount) < 0.01
        AND ABS(cp.fecha_pago_sat::date - NEW.date) <= 1
      LIMIT 1
    );
  ELSE
    v_canonical_id := 'odoo:' || NEW.id::text;
  END IF;

  INSERT INTO canonical_payments (
    canonical_id, odoo_payment_id, direction,
    amount_odoo, amount_mxn_odoo, currency_odoo, payment_date_odoo,
    payment_method_odoo, journal_name, is_reconciled, reconciled_invoices_count,
    odoo_ref, odoo_partner_id, counterparty_company_id,
    has_odoo_record, sources_present, source_hashes
  ) VALUES (
    v_canonical_id, NEW.id,
    CASE NEW.payment_type WHEN 'inbound' THEN 'received' ELSE 'sent' END,
    NEW.amount, COALESCE(NEW.amount_signed, NEW.amount),
    NEW.currency, NEW.date,
    NEW.payment_method, NEW.journal_name, NEW.is_reconciled, NEW.reconciled_invoices_count,
    NEW.ref, NEW.odoo_partner_id, NEW.company_id,
    true, ARRAY['odoo'],
    jsonb_build_object('odoo_synced_at', NEW.synced_at)
  )
  ON CONFLICT (canonical_id) DO UPDATE SET
    odoo_payment_id = EXCLUDED.odoo_payment_id,
    amount_odoo = EXCLUDED.amount_odoo,
    amount_mxn_odoo = EXCLUDED.amount_mxn_odoo,
    currency_odoo = EXCLUDED.currency_odoo,
    payment_date_odoo = EXCLUDED.payment_date_odoo,
    payment_method_odoo = EXCLUDED.payment_method_odoo,
    journal_name = EXCLUDED.journal_name,
    is_reconciled = EXCLUDED.is_reconciled,
    reconciled_invoices_count = EXCLUDED.reconciled_invoices_count,
    odoo_ref = EXCLUDED.odoo_ref,
    odoo_partner_id = EXCLUDED.odoo_partner_id,
    counterparty_company_id = COALESCE(canonical_payments.counterparty_company_id, EXCLUDED.counterparty_company_id),
    has_odoo_record = true,
    sources_present = ARRAY(SELECT DISTINCT unnest(canonical_payments.sources_present || ARRAY['odoo'])),
    amount_resolved = COALESCE(EXCLUDED.amount_odoo, canonical_payments.amount_sat),
    amount_mxn_resolved = COALESCE(EXCLUDED.amount_mxn_odoo, canonical_payments.amount_mxn_sat),
    payment_date_resolved = COALESCE(EXCLUDED.payment_date_odoo, canonical_payments.fecha_pago_sat::date),
    source_hashes = COALESCE(canonical_payments.source_hashes, '{}'::jsonb)
                    || jsonb_build_object('odoo_synced_at', NEW.synced_at);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ====================================================================
-- SAT-side upsert trigger + allocation re-population
-- ====================================================================
CREATE OR REPLACE FUNCTION canonical_payments_upsert_from_sat() RETURNS trigger AS $$
DECLARE
  v_canonical_id text;
BEGIN
  -- If existing canonical row matches via num_operacion (future case), consolidate.
  -- Current data: matches 0 rows.
  v_canonical_id := 'sat:' || NEW.uuid_complemento;
  IF NEW.num_operacion IS NOT NULL AND NEW.num_operacion <> '' AND EXISTS(
    SELECT 1 FROM canonical_payments cp
    JOIN odoo_account_payments oap ON oap.id = cp.odoo_payment_id
    WHERE oap.ref = NEW.num_operacion
      AND ABS(oap.amount - NEW.monto) < 0.01
      AND ABS(oap.date - NEW.fecha_pago::date) <= 1
  ) THEN
    v_canonical_id := (
      SELECT cp.canonical_id
      FROM canonical_payments cp
      JOIN odoo_account_payments oap ON oap.id = cp.odoo_payment_id
      WHERE oap.ref = NEW.num_operacion
        AND ABS(oap.amount - NEW.monto) < 0.01
        AND ABS(oap.date - NEW.fecha_pago::date) <= 1
      LIMIT 1
    );
  END IF;

  -- Also reuse existing SAT-uuid row if present (symmetric collision guard)
  IF EXISTS(SELECT 1 FROM canonical_payments WHERE sat_uuid_complemento = NEW.uuid_complemento) THEN
    v_canonical_id := (SELECT canonical_id FROM canonical_payments WHERE sat_uuid_complemento = NEW.uuid_complemento LIMIT 1);
  END IF;

  INSERT INTO canonical_payments (
    canonical_id, sat_uuid_complemento, direction,
    amount_sat, amount_mxn_sat, currency_sat, tipo_cambio_sat, fecha_pago_sat, forma_pago_sat,
    num_operacion, rfc_emisor_cta_ord, rfc_emisor_cta_ben, estado_sat,
    has_sat_record, sources_present, source_hashes
  ) VALUES (
    v_canonical_id, NEW.uuid_complemento,
    CASE NEW.direction WHEN 'issued' THEN 'received' WHEN 'received' THEN 'sent' END,
    NEW.monto, NEW.monto * COALESCE(NEW.tipo_cambio_p, 1),
    NEW.moneda_p, NEW.tipo_cambio_p, NEW.fecha_pago, NEW.forma_pago_p,
    NEW.num_operacion, NEW.rfc_emisor_cta_ord, NEW.rfc_emisor_cta_ben, NEW.estado_sat,
    true, ARRAY['sat'],
    jsonb_build_object('sat_synced_at', NEW.synced_at)
  )
  ON CONFLICT (canonical_id) DO UPDATE SET
    sat_uuid_complemento = EXCLUDED.sat_uuid_complemento,
    amount_sat = EXCLUDED.amount_sat,
    amount_mxn_sat = EXCLUDED.amount_mxn_sat,
    currency_sat = EXCLUDED.currency_sat,
    tipo_cambio_sat = EXCLUDED.tipo_cambio_sat,
    fecha_pago_sat = EXCLUDED.fecha_pago_sat,
    forma_pago_sat = EXCLUDED.forma_pago_sat,
    num_operacion = EXCLUDED.num_operacion,
    rfc_emisor_cta_ord = EXCLUDED.rfc_emisor_cta_ord,
    rfc_emisor_cta_ben = EXCLUDED.rfc_emisor_cta_ben,
    estado_sat = EXCLUDED.estado_sat,
    has_sat_record = true,
    sources_present = ARRAY(SELECT DISTINCT unnest(canonical_payments.sources_present || ARRAY['sat'])),
    amount_resolved = COALESCE(canonical_payments.amount_odoo, EXCLUDED.amount_sat),
    amount_mxn_resolved = COALESCE(canonical_payments.amount_mxn_odoo, EXCLUDED.amount_mxn_sat),
    payment_date_resolved = COALESCE(canonical_payments.payment_date_odoo, EXCLUDED.fecha_pago_sat::date),
    source_hashes = COALESCE(canonical_payments.source_hashes, '{}'::jsonb)
                    || jsonb_build_object('sat_synced_at', NEW.synced_at);

  -- Re-populate allocations from the new doctos_relacionados (correct jsonb keys)
  DELETE FROM canonical_payment_allocations
   WHERE payment_canonical_id = v_canonical_id AND source = 'sat_complemento';

  INSERT INTO canonical_payment_allocations (
    payment_canonical_id, invoice_canonical_id, allocated_amount, currency, source,
    sat_saldo_anterior, sat_saldo_insoluto, sat_num_parcialidad
  )
  SELECT
    v_canonical_id,
    d->>'uuid_docto',
    (d->>'imp_pagado')::numeric,
    d->>'moneda_dr',
    'sat_complemento',
    NULLIF(d->>'imp_saldo_ant', '')::numeric,
    NULLIF(d->>'imp_saldo_insoluto', '')::numeric,
    NULLIF(d->>'parcialidad', '')::integer
  FROM jsonb_array_elements(COALESCE(NEW.doctos_relacionados, '[]'::jsonb)) AS d
  WHERE d ? 'uuid_docto'
  ON CONFLICT (payment_canonical_id, invoice_canonical_id, source) DO NOTHING;

  -- Update allocation cache on canonical_payments
  UPDATE canonical_payments cp
  SET
    allocation_count = agg.cnt,
    allocated_invoices_uuid = agg.uuids,
    amount_allocated = agg.total
  FROM (
    SELECT COUNT(*) AS cnt, array_agg(invoice_canonical_id) AS uuids, SUM(allocated_amount) AS total
    FROM canonical_payment_allocations WHERE payment_canonical_id = v_canonical_id
  ) agg
  WHERE cp.canonical_id = v_canonical_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_canonical_payments_from_odoo ON odoo_account_payments;
CREATE TRIGGER trg_canonical_payments_from_odoo
  AFTER INSERT OR UPDATE ON odoo_account_payments
  FOR EACH ROW EXECUTE FUNCTION canonical_payments_upsert_from_odoo();

DROP TRIGGER IF EXISTS trg_canonical_payments_from_sat ON syntage_invoice_payments;
CREATE TRIGGER trg_canonical_payments_from_sat
  AFTER INSERT OR UPDATE ON syntage_invoice_payments
  FOR EACH ROW EXECUTE FUNCTION canonical_payments_upsert_from_sat();

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_trigger','canonical_payments','SP2 Task 7: incremental triggers (Odoo+SAT) with correct English direction + jsonb keys','20260422_sp2_07_canonical_payments_trigger.sql','silver-sp2',true);

COMMIT;
