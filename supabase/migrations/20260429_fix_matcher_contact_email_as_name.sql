-- Fix raíz del bug "email-as-name" en canonical_contacts.
--
-- Bug original: trigger canonical_contacts_upsert_from_contact() hace
--   VALUES (LOWER(NEW.email), NEW.name, LOWER(NEW.name), ...)
-- Cuando NEW.name es un email (porque el partner Odoo solo tiene email sin
-- nombre persona), canonical_name queda como email. Resultado: 103 contacts
-- con canonical_name='admin@noone.com.mx' style.
--
-- Fix:
--   1) Modificar el trigger para detectar email-as-name y usar el local-part
--      (la parte antes del @) como fallback. Ej: 'admin@noone.com.mx' →
--      canonical_name = 'admin'.
--   2) ON CONFLICT update: si canonical_name actual es email pero el nuevo no,
--      actualizarlo (auto-heal en futuros syncs).
--   3) Backfill los 103 existentes:
--      - 5 con bronze.contacts.name real → usar bronze name
--      - 98 sin nombre real → usar local-part del email
--
-- Esto previene futuros + corrige los 103 actuales en una sola migration.

BEGIN;

CREATE OR REPLACE FUNCTION public.canonical_contacts_upsert_from_contact()
RETURNS trigger
LANGUAGE plpgsql
AS $func$
DECLARE
  v_cc_id bigint;
  v_clean_name text;
  v_canonical_name text;
BEGIN
  IF NEW.email IS NULL OR NEW.email = '' THEN RETURN NEW; END IF;

  SELECT cc.id INTO v_cc_id
  FROM canonical_companies cc JOIN companies comp ON comp.canonical_name=cc.canonical_name
  WHERE comp.id = NEW.company_id LIMIT 1;

  v_clean_name := COALESCE(NULLIF(TRIM(NEW.name), ''), '');
  IF v_clean_name ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    v_clean_name := SPLIT_PART(v_clean_name, '@', 1);
  END IF;
  v_canonical_name := LOWER(v_clean_name);

  INSERT INTO canonical_contacts (
    primary_email, display_name, canonical_name, odoo_partner_id,
    canonical_company_id, is_customer, is_supplier, contact_type,
    match_method, match_confidence, last_matched_at
  )
  VALUES (
    LOWER(NEW.email), v_clean_name, v_canonical_name, NEW.odoo_partner_id, v_cc_id,
    COALESCE(NEW.is_customer, false), COALESCE(NEW.is_supplier, false),
    CASE WHEN COALESCE(NEW.is_customer, false) THEN 'external_customer'
         WHEN COALESCE(NEW.is_supplier, false) THEN 'external_supplier'
         ELSE 'external_unresolved' END,
    'email_exact', 0.99, now()
  )
  ON CONFLICT ((LOWER(primary_email))) DO UPDATE SET
    odoo_partner_id = COALESCE(canonical_contacts.odoo_partner_id, EXCLUDED.odoo_partner_id),
    canonical_company_id = COALESCE(canonical_contacts.canonical_company_id, EXCLUDED.canonical_company_id),
    is_customer = canonical_contacts.is_customer OR EXCLUDED.is_customer,
    is_supplier = canonical_contacts.is_supplier OR EXCLUDED.is_supplier,
    canonical_name = CASE
      WHEN canonical_contacts.canonical_name LIKE '%@%' AND EXCLUDED.canonical_name NOT LIKE '%@%'
        THEN EXCLUDED.canonical_name
      ELSE canonical_contacts.canonical_name
    END,
    display_name = CASE
      WHEN canonical_contacts.display_name LIKE '%@%' AND EXCLUDED.display_name NOT LIKE '%@%'
        THEN EXCLUDED.display_name
      ELSE canonical_contacts.display_name
    END,
    last_matched_at = now();
  RETURN NEW;
END;
$func$;

WITH bad_contacts AS (
  SELECT
    cc.id,
    cc.canonical_name AS old_name,
    cc.primary_email,
    (SELECT c.name FROM contacts c
       WHERE c.odoo_partner_id = cc.odoo_partner_id
         AND c.name IS NOT NULL AND c.name <> '' AND c.name NOT LIKE '%@%'
       LIMIT 1) AS bronze_name,
    SPLIT_PART(cc.primary_email, '@', 1) AS email_local
  FROM canonical_contacts cc
  WHERE cc.canonical_name LIKE '%@%'
)
UPDATE canonical_contacts cc
SET
  canonical_name = LOWER(COALESCE(b.bronze_name, b.email_local)),
  display_name = COALESCE(b.bronze_name, b.email_local),
  last_matched_at = now()
FROM bad_contacts b
WHERE cc.id = b.id;

UPDATE agent_insights
SET state = 'acted_on', updated_at = now(),
    evidence = evidence || jsonb_build_object('backfilled_at', now())
WHERE insight_type = 'mdm_contact_name_is_email'
  AND state IN ('new','seen')
  AND NOT EXISTS (
    SELECT 1 FROM canonical_contacts WHERE canonical_name LIKE '%@%'
  );

INSERT INTO pipeline_logs (level, phase, message, details)
VALUES (
  'info',
  'fix_matcher_contact_email_as_name',
  'Fixed root cause + backfilled 103 canonical_contacts with email-as-name. Trigger now uses email local-part as fallback when name is email.',
  jsonb_build_object(
    'trigger_updated', 'canonical_contacts_upsert_from_contact',
    'rows_backfilled', 103,
    'tier_a_bronze_name', 5,
    'tier_b_email_local', 98
  )
);

COMMIT;
