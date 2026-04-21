BEGIN;

CREATE OR REPLACE FUNCTION matcher_contact(
  p_email text,
  p_name text DEFAULT NULL,
  p_domain text DEFAULT NULL
) RETURNS bigint AS $$
DECLARE v_id bigint;
BEGIN
  IF p_email IS NULL OR p_email = '' THEN
    IF p_name IS NULL THEN RETURN NULL; END IF;
    SELECT id INTO v_id FROM canonical_contacts
      WHERE similarity(canonical_name, LOWER(p_name)) >= 0.85
      ORDER BY similarity(canonical_name, LOWER(p_name)) DESC,
               has_manual_override DESC, id ASC
      LIMIT 1;
    RETURN v_id;
  END IF;

  -- Email exact (case-insensitive)
  SELECT id INTO v_id FROM canonical_contacts
    WHERE LOWER(primary_email) = LOWER(p_email)
    ORDER BY has_manual_override DESC, id ASC
    LIMIT 1;
  IF FOUND THEN RETURN v_id; END IF;

  -- Domain match via canonical_company
  IF p_domain IS NULL THEN p_domain := SPLIT_PART(p_email, '@', 2); END IF;
  IF p_domain IS NOT NULL AND p_domain <> '' THEN
    SELECT cct.id INTO v_id
    FROM canonical_contacts cct
    JOIN canonical_companies ccomp ON ccomp.id = cct.canonical_company_id
    WHERE ccomp.primary_email_domain = LOWER(p_domain)
    ORDER BY cct.has_manual_override DESC, cct.id ASC
    LIMIT 1;
    IF FOUND THEN RETURN v_id; END IF;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION matcher_product(
  p_internal_ref text,
  p_name text DEFAULT NULL
) RETURNS bigint AS $$
DECLARE v_id bigint;
BEGIN
  IF p_internal_ref IS NOT NULL AND p_internal_ref <> '' THEN
    SELECT id INTO v_id FROM canonical_products
      WHERE internal_ref = p_internal_ref
      ORDER BY has_manual_override DESC, id ASC
      LIMIT 1;
    IF FOUND THEN RETURN v_id; END IF;
  END IF;

  IF p_name IS NOT NULL AND p_name <> '' THEN
    SELECT id INTO v_id FROM canonical_products
      WHERE similarity(canonical_name, LOWER(p_name)) >= 0.85
      ORDER BY similarity(canonical_name, LOWER(p_name)) DESC,
               has_manual_override DESC, id ASC
      LIMIT 1;
    RETURN v_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_function','canonical_contacts','SP3 Task 16: matcher_contact + matcher_product','20260423_sp3_16_matcher_contact_product.sql','silver-sp3',true);

COMMIT;
