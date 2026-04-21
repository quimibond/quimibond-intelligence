-- SP3 Task 15b: matcher_company tie-break for duplicate-RFC rows
--
-- Issue: canonical_companies can have multiple rows with same RFC (e.g., Quimibond group shares
-- PNT920218IW5 across "PRODUCTORA DE NO TEJIDOS QUIMIBOND" id=868 is_internal=true and
-- "PREMIER WORLD CHEMICALS LLC" id=138 is_internal=false). LIMIT 1 without ORDER BY returned
-- id=138 non-deterministically. Fix: order by (has_manual_override, is_internal, NOT has_shadow_flag, id ASC).
--
-- Also applies same deterministic preference to fuzzy name match + domain match paths.

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
      ORDER BY similarity(canonical_name, LOWER(p_name)) DESC,
               has_manual_override DESC, is_internal DESC,
               has_shadow_flag ASC, id ASC
      LIMIT 1;
    RETURN v_id;
  END IF;

  -- RFC exact with deterministic preference: manual_override > is_internal > !shadow > lowest id
  SELECT id INTO v_id FROM canonical_companies
    WHERE rfc = p_rfc
    ORDER BY has_manual_override DESC, is_internal DESC, has_shadow_flag ASC, id ASC
    LIMIT 1;
  IF FOUND THEN RETURN v_id; END IF;

  -- Generic RFC → fuzzy name
  IF p_rfc IN ('XEXX010101000','XAXX010101000') AND p_name IS NOT NULL THEN
    SELECT id INTO v_id FROM canonical_companies
      WHERE similarity(canonical_name, LOWER(p_name)) >= 0.90
      ORDER BY similarity(canonical_name, LOWER(p_name)) DESC,
               has_manual_override DESC, is_internal DESC,
               has_shadow_flag ASC, id ASC
      LIMIT 1;
    RETURN v_id;
  END IF;

  -- Domain match
  IF p_domain IS NOT NULL THEN
    SELECT id INTO v_id FROM canonical_companies
      WHERE primary_email_domain = LOWER(p_domain)
      ORDER BY has_manual_override DESC, is_internal DESC, has_shadow_flag ASC, id ASC
      LIMIT 1;
    IF FOUND THEN RETURN v_id; END IF;
  END IF;

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
      SELECT id INTO v_id FROM canonical_companies
        WHERE rfc = p_rfc
        ORDER BY has_manual_override DESC, is_internal DESC, has_shadow_flag ASC, id ASC
        LIMIT 1;
    END IF;
  END IF;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_function','canonical_companies','SP3 Task 15b: matcher_company deterministic tie-break (prefer is_internal, !shadow, lowest id)','20260423_sp3_15b_matcher_company_tiebreak.sql','silver-sp3',true);

COMMIT;
