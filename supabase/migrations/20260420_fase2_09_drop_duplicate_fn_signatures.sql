-- Fase 2 Limpieza: drop 4 duplicate function signatures (keep 1 per fn).
-- Canonical kept per function: the parameterized variant (more flexible
-- and more efficient when called with explicit arguments).
--
-- Kept:
--   get_contact_health_history(bigint, int)  — numeric ID more efficient
--   get_volume_trend(int)                    — parameterizable window
--   match_emails_to_companies_by_domain(int) — parameterizable batch size
--   match_emails_to_contacts_by_email(int)   — parameterizable batch size

BEGIN;
  DROP FUNCTION IF EXISTS public.get_contact_health_history(text, integer);
  DROP FUNCTION IF EXISTS public.get_volume_trend();
  DROP FUNCTION IF EXISTS public.match_emails_to_companies_by_domain();
  DROP FUNCTION IF EXISTS public.match_emails_to_contacts_by_email();

  INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed)
  VALUES (
    'drop_function',
    NULL,
    'Fase 2 — drop 4 firmas duplicadas. Keep: get_contact_health_history(bigint,int), get_volume_trend(int), match_emails_to_companies_by_domain(int), match_emails_to_contacts_by_email(int)',
    'DROP FUNCTION get_contact_health_history(text,int), get_volume_trend(), match_emails_to_companies_by_domain(), match_emails_to_contacts_by_email()'
  );
COMMIT;
