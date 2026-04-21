BEGIN;

CREATE OR REPLACE FUNCTION mdm_merge_companies(
  p_canonical_a bigint,
  p_canonical_b bigint,
  p_user_email text,
  p_note text DEFAULT NULL
) RETURNS bigint AS $$
DECLARE v_survivor bigint; v_victim bigint;
BEGIN
  IF p_canonical_a = p_canonical_b THEN RAISE EXCEPTION 'Cannot merge a company with itself'; END IF;

  SELECT id INTO v_survivor FROM canonical_companies
   WHERE id IN (p_canonical_a, p_canonical_b)
   ORDER BY has_manual_override DESC, lifetime_value_mxn DESC, (NOT has_shadow_flag) DESC, id ASC LIMIT 1;
  v_victim := CASE WHEN v_survivor = p_canonical_a THEN p_canonical_b ELSE p_canonical_a END;

  UPDATE canonical_invoices     SET emisor_company_id     = v_survivor WHERE emisor_company_id     = v_victim;
  UPDATE canonical_invoices     SET receptor_company_id   = v_survivor WHERE receptor_company_id   = v_victim;
  UPDATE canonical_payments     SET counterparty_company_id = v_survivor WHERE counterparty_company_id = v_victim;
  UPDATE canonical_credit_notes SET emisor_company_id     = v_survivor WHERE emisor_company_id     = v_victim;
  UPDATE canonical_credit_notes SET receptor_company_id   = v_survivor WHERE receptor_company_id   = v_victim;
  UPDATE canonical_contacts     SET canonical_company_id  = v_survivor WHERE canonical_company_id  = v_victim;

  UPDATE source_links SET canonical_entity_id = v_survivor::text
  WHERE canonical_entity_type='company' AND canonical_entity_id = v_victim::text;

  UPDATE canonical_companies SET has_manual_override = true, last_matched_at = now() WHERE id = v_survivor;

  INSERT INTO mdm_manual_overrides (entity_type, canonical_id, override_field, override_value, action, payload, linked_by, note, is_active)
  VALUES ('company', v_survivor::text, 'canonical_id', v_survivor::text, 'merge',
          jsonb_build_object('merged_from', v_victim, 'merged_into', v_survivor),
          p_user_email, p_note, true);

  DELETE FROM canonical_companies WHERE id = v_victim;
  RETURN v_survivor;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION mdm_link_invoice(
  p_canonical_id text,
  p_sat_uuid text,
  p_odoo_invoice_id bigint DEFAULT NULL,
  p_user_email text DEFAULT 'system',
  p_note text DEFAULT NULL
) RETURNS void AS $$
BEGIN
  UPDATE canonical_invoices
  SET sat_uuid = p_sat_uuid,
      odoo_invoice_id = COALESCE(p_odoo_invoice_id, odoo_invoice_id),
      resolved_from = 'manual_bridge',
      match_confidence = 'exact',
      has_manual_link = true,
      last_reconciled_at = now()
  WHERE canonical_id = p_canonical_id;

  INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by, notes)
  VALUES ('invoice', p_canonical_id, 'sat', 'syntage_invoices', p_sat_uuid, p_sat_uuid, 'manual_override', 1.000, 'user:' || p_user_email, p_note)
  ON CONFLICT (canonical_entity_type, source, source_id) WHERE superseded_at IS NULL DO NOTHING;

  INSERT INTO mdm_manual_overrides (entity_type, canonical_id, override_field, override_value, action, payload, linked_by, note, is_active)
  VALUES ('invoice', p_canonical_id, 'sat_uuid', p_sat_uuid, 'link',
          jsonb_build_object('sat_uuid', p_sat_uuid, 'odoo_invoice_id', p_odoo_invoice_id),
          p_user_email, p_note, true);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION mdm_revoke_override(
  p_override_id bigint,
  p_user_email text,
  p_reason text
) RETURNS void AS $$
DECLARE v_row record;
BEGIN
  UPDATE mdm_manual_overrides
  SET is_active = false, revoke_reason = p_reason
  WHERE id = p_override_id
  RETURNING entity_type, canonical_id INTO v_row;

  IF v_row.entity_type = 'invoice' THEN
    UPDATE canonical_invoices
    SET has_manual_link = false, resolved_from = NULL
    WHERE canonical_id = v_row.canonical_id;
    UPDATE source_links SET superseded_at = now()
    WHERE canonical_entity_type='invoice' AND canonical_entity_id = v_row.canonical_id
      AND match_method='manual_override';
  ELSIF v_row.entity_type = 'company' THEN
    UPDATE canonical_companies SET has_manual_override = false WHERE id::text = v_row.canonical_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_function','mdm_manual_overrides','SP3 Task 18: manual override functions','20260423_sp3_18_manual_override_functions.sql','silver-sp3',true);

COMMIT;
