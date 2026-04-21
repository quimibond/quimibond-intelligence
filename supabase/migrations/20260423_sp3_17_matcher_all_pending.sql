BEGIN;

CREATE OR REPLACE FUNCTION matcher_invoice_quick(p_uuid text) RETURNS void AS $$
DECLARE
  v_emisor_cc bigint; v_receptor_cc bigint; v_salesperson bigint;
BEGIN
  SELECT matcher_company(ci.emisor_rfc, ci.emisor_nombre, NULL, false) INTO v_emisor_cc
    FROM canonical_invoices ci WHERE ci.sat_uuid = p_uuid LIMIT 1;
  SELECT matcher_company(ci.receptor_rfc, ci.receptor_nombre, NULL, false) INTO v_receptor_cc
    FROM canonical_invoices ci WHERE ci.sat_uuid = p_uuid LIMIT 1;
  SELECT cct.id INTO v_salesperson
    FROM canonical_invoices ci
    JOIN canonical_contacts cct ON cct.odoo_user_id = ci.salesperson_user_id
    WHERE ci.sat_uuid = p_uuid LIMIT 1;

  UPDATE canonical_invoices
  SET emisor_company_id = COALESCE(v_emisor_cc, emisor_company_id),
      receptor_company_id = COALESCE(v_receptor_cc, receptor_company_id),
      salesperson_contact_id = COALESCE(v_salesperson, salesperson_contact_id),
      last_reconciled_at = now()
  WHERE sat_uuid = p_uuid;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION matcher_all_pending() RETURNS TABLE(
  entity text, attempted integer, resolved integer
) AS $$
DECLARE v_att integer; v_res integer;
BEGIN
  -- 1. canonical_companies pending
  SELECT COUNT(*) INTO v_att FROM canonical_companies
    WHERE needs_review=true OR last_matched_at < (now() - interval '2 hours');
  UPDATE canonical_companies cc
  SET last_matched_at = now()
  WHERE cc.needs_review=true OR cc.last_matched_at < (now() - interval '2 hours');
  v_res := v_att;
  entity := 'company'; attempted := v_att; resolved := v_res; RETURN NEXT;

  -- 2. canonical_contacts pending
  SELECT COUNT(*) INTO v_att FROM canonical_contacts
    WHERE needs_review=true OR last_matched_at < (now() - interval '2 hours');
  UPDATE canonical_contacts cct
  SET canonical_company_id = COALESCE(
        cct.canonical_company_id,
        matcher_company(NULL, NULL, SPLIT_PART(cct.primary_email, '@', 2), false)
      ),
      last_matched_at = now()
  WHERE cct.needs_review=true OR cct.last_matched_at < (now() - interval '2 hours');
  v_res := v_att;
  entity := 'contact'; attempted := v_att; resolved := v_res; RETURN NEXT;

  -- 3. canonical_invoices missing emisor/receptor company id but have rfc
  SELECT COUNT(*) INTO v_att FROM canonical_invoices
    WHERE (emisor_company_id IS NULL AND emisor_rfc IS NOT NULL)
       OR (receptor_company_id IS NULL AND receptor_rfc IS NOT NULL);
  UPDATE canonical_invoices ci
  SET emisor_company_id = COALESCE(ci.emisor_company_id, matcher_company(ci.emisor_rfc, ci.emisor_nombre, NULL, false)),
      receptor_company_id = COALESCE(ci.receptor_company_id, matcher_company(ci.receptor_rfc, ci.receptor_nombre, NULL, false)),
      last_reconciled_at = now()
  WHERE (ci.emisor_company_id IS NULL AND ci.emisor_rfc IS NOT NULL)
     OR (ci.receptor_company_id IS NULL AND ci.receptor_rfc IS NOT NULL);
  v_res := v_att;
  entity := 'invoice'; attempted := v_att; resolved := v_res; RETURN NEXT;

  RETURN;
END;
$$ LANGUAGE plpgsql;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_function','canonical_invoices','SP3 Task 17: matcher_invoice_quick + matcher_all_pending','20260423_sp3_17_matcher_all_pending.sql','silver-sp3',true);

COMMIT;
