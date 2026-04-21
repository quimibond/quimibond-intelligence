-- SP2 Task 13: Incremental triggers for canonical_tax_events + defer Odoo match to SP4
--
-- Why deferred:
-- 1. Plan's `odoo_account_balances` WHERE account_code LIKE '216%' is wrong —
--    actual Quimibond ISR accounts live in 113.% and 213.% with multiple semantic
--    variants (retenido por clientes, retenido por inversiones, por pagar). Choosing
--    the right aggregate requires business-rule decision.
-- 2. Plan's `tax_return.numero_operacion = odoo_account_payments.ref` match — 100%
--    of odoo_account_payments.ref is empty in current data. 0 matches possible.
--
-- SP4 finance engine will implement proper account-code mapping + new reconciliation
-- strategies (direct journal entries, not payment.ref).

BEGIN;

-- ====================================================================
-- Retention trigger
-- ====================================================================
CREATE OR REPLACE FUNCTION canonical_tax_events_upsert_retention() RETURNS trigger AS $$
BEGIN
  INSERT INTO canonical_tax_events (
    canonical_id, event_type, sat_record_id, retention_uuid,
    tipo_retencion, monto_total_retenido,
    emisor_rfc, receptor_rfc, retention_fecha_emision, sat_estado,
    taxpayer_rfc, source_hashes
  ) VALUES (
    'retention:' || COALESCE(NEW.uuid, NEW.syntage_id),
    'retention', NEW.syntage_id, NEW.uuid,
    NEW.tipo_retencion, NEW.monto_total_retenido,
    NEW.emisor_rfc, NEW.receptor_rfc, NEW.fecha_emision, NEW.estado_sat,
    COALESCE(NEW.taxpayer_rfc, 'PNT920218IW5'),
    jsonb_build_object('sat_synced_at', NEW.synced_at)
  )
  ON CONFLICT (canonical_id) DO UPDATE SET
    monto_total_retenido = EXCLUDED.monto_total_retenido,
    sat_estado = EXCLUDED.sat_estado,
    source_hashes = COALESCE(canonical_tax_events.source_hashes,'{}'::jsonb) || EXCLUDED.source_hashes;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ====================================================================
-- Tax return trigger
-- ====================================================================
CREATE OR REPLACE FUNCTION canonical_tax_events_upsert_return() RETURNS trigger AS $$
BEGIN
  INSERT INTO canonical_tax_events (
    canonical_id, event_type, sat_record_id,
    return_ejercicio, return_periodo, return_impuesto,
    return_tipo_declaracion, return_fecha_presentacion, return_monto_pagado, return_numero_operacion,
    taxpayer_rfc, source_hashes
  ) VALUES (
    'return:' || NEW.ejercicio || '-' || COALESCE(NEW.periodo,'X') || '-' || COALESCE(NEW.impuesto,'X') || '-' || NEW.syntage_id,
    'tax_return', NEW.syntage_id,
    NEW.ejercicio, NEW.periodo, NEW.impuesto,
    NEW.tipo_declaracion, NEW.fecha_presentacion, NEW.monto_pagado, NEW.numero_operacion,
    COALESCE(NEW.taxpayer_rfc, 'PNT920218IW5'),
    jsonb_build_object('sat_synced_at', NEW.synced_at)
  )
  ON CONFLICT (canonical_id) DO UPDATE SET
    return_monto_pagado = EXCLUDED.return_monto_pagado,
    return_numero_operacion = EXCLUDED.return_numero_operacion,
    source_hashes = COALESCE(canonical_tax_events.source_hashes,'{}'::jsonb) || EXCLUDED.source_hashes;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ====================================================================
-- Electronic accounting trigger
-- ====================================================================
CREATE OR REPLACE FUNCTION canonical_tax_events_upsert_ea() RETURNS trigger AS $$
BEGIN
  INSERT INTO canonical_tax_events (
    canonical_id, event_type, sat_record_id,
    acct_ejercicio, acct_periodo, acct_record_type, acct_tipo_envio, acct_hash,
    taxpayer_rfc, source_hashes
  ) VALUES (
    'acct:' || NEW.ejercicio || '-' || COALESCE(NEW.periodo,'X') || '-' || COALESCE(NEW.record_type,'X') || '-' || NEW.syntage_id,
    'electronic_accounting', NEW.syntage_id,
    NEW.ejercicio, NEW.periodo, NEW.record_type, NEW.tipo_envio, NEW.hash,
    COALESCE(NEW.taxpayer_rfc, 'PNT920218IW5'),
    jsonb_build_object('sat_synced_at', NEW.synced_at)
  )
  ON CONFLICT (canonical_id) DO UPDATE SET
    acct_hash = EXCLUDED.acct_hash,
    source_hashes = COALESCE(canonical_tax_events.source_hashes,'{}'::jsonb) || EXCLUDED.source_hashes;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cte_retention ON syntage_tax_retentions;
CREATE TRIGGER trg_cte_retention AFTER INSERT OR UPDATE ON syntage_tax_retentions
  FOR EACH ROW EXECUTE FUNCTION canonical_tax_events_upsert_retention();

DROP TRIGGER IF EXISTS trg_cte_return ON syntage_tax_returns;
CREATE TRIGGER trg_cte_return AFTER INSERT OR UPDATE ON syntage_tax_returns
  FOR EACH ROW EXECUTE FUNCTION canonical_tax_events_upsert_return();

DROP TRIGGER IF EXISTS trg_cte_ea ON syntage_electronic_accounting;
CREATE TRIGGER trg_cte_ea AFTER INSERT OR UPDATE ON syntage_electronic_accounting
  FOR EACH ROW EXECUTE FUNCTION canonical_tax_events_upsert_ea();

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_trigger','canonical_tax_events',
  'SP2 Task 13: incremental triggers (retention/return/EA). Odoo reconciliation deferred to SP4 (dead bridges: wrong account prefix in plan, empty odoo_account_payments.ref)',
  '20260422_sp2_13_canonical_tax_events_triggers.sql','silver-sp2',true);

COMMIT;
