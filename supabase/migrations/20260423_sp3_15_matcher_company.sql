BEGIN;

CREATE OR REPLACE FUNCTION matcher_company(
  p_rfc text,
  p_name text DEFAULT NULL,
  p_domain text DEFAULT NULL,
  p_autocreate_shadow boolean DEFAULT false
) RETURNS bigint AS $$
DECLARE v_id bigint;
BEGIN
  IF p_rfc IS NULL OR p_rfc = '' THEN
    IF p_name IS NULL OR p_name = '' THEN RETURN NULL; END IF;
    SELECT id INTO v_id FROM canonical_companies
      WHERE similarity(canonical_name, LOWER(p_name)) >= 0.85
      ORDER BY similarity(canonical_name, LOWER(p_name)) DESC LIMIT 1;
    RETURN v_id;
  END IF;

  -- RFC exact
  SELECT id INTO v_id FROM canonical_companies WHERE rfc = p_rfc LIMIT 1;
  IF FOUND THEN RETURN v_id; END IF;

  -- Generic RFC → fuzzy name
  IF p_rfc IN ('XEXX010101000','XAXX010101000') AND p_name IS NOT NULL THEN
    SELECT id INTO v_id FROM canonical_companies
      WHERE similarity(canonical_name, LOWER(p_name)) >= 0.90
      ORDER BY similarity(canonical_name, LOWER(p_name)) DESC LIMIT 1;
    RETURN v_id;
  END IF;

  -- Domain match
  IF p_domain IS NOT NULL THEN
    SELECT id INTO v_id FROM canonical_companies
      WHERE primary_email_domain = LOWER(p_domain) LIMIT 1;
    IF FOUND THEN RETURN v_id; END IF;
  END IF;

  -- Autocreate shadow
  IF p_autocreate_shadow THEN
    INSERT INTO canonical_companies (
      canonical_name, display_name, rfc,
      has_shadow_flag, shadow_reason,
      match_method, match_confidence, needs_review, review_reason, last_matched_at
    ) VALUES (
      LOWER(COALESCE(p_name, p_rfc)),
      COALESCE(p_name, p_rfc),
      p_rfc, true, 'sat_cfdi_only_post_2021',
      'sat_only', 0.50, true, ARRAY['sat_only_shadow'], now()
    )
    ON CONFLICT (canonical_name) DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM canonical_companies WHERE rfc = p_rfc LIMIT 1;
    END IF;
  END IF;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION matcher_company_if_new_rfc(
  p_emisor_rfc text, p_emisor_nombre text,
  p_receptor_rfc text, p_receptor_nombre text
) RETURNS void AS $$
BEGIN
  PERFORM matcher_company(p_emisor_rfc, p_emisor_nombre, NULL, true);
  PERFORM matcher_company(p_receptor_rfc, p_receptor_nombre, NULL, true);
END;
$$ LANGUAGE plpgsql;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_function','canonical_companies','SP3 Task 15: matcher_company + matcher_company_if_new_rfc','20260423_sp3_15_matcher_company.sql','silver-sp3',true);

COMMIT;
