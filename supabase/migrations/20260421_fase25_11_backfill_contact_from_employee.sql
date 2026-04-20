BEGIN;

-- Trigger function: auto-create contact when employee with work_email is inserted/updated
-- Adapted: contacts table has no 'phone' column, so only email+name are inserted.
CREATE OR REPLACE FUNCTION public.trg_backfill_contact_from_employee()
RETURNS trigger LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.work_email IS NULL OR NEW.work_email = '' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.contacts (email, name)
  VALUES (lower(NEW.work_email), NEW.name)
  ON CONFLICT (email) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_backfill_contact_from_employee ON public.odoo_employees;
CREATE TRIGGER trg_backfill_contact_from_employee
AFTER INSERT OR UPDATE OF work_email, name ON public.odoo_employees
FOR EACH ROW EXECUTE FUNCTION public.trg_backfill_contact_from_employee();

-- Historical backfill: insert contacts for employees that don't have one yet
DO $$
DECLARE v_count int;
BEGIN
  WITH ins AS (
    INSERT INTO public.contacts (email, name)
    SELECT DISTINCT lower(e.work_email), e.name
    FROM public.odoo_employees e
    WHERE e.work_email IS NOT NULL AND e.work_email <> ''
      AND NOT EXISTS (
        SELECT 1 FROM public.contacts c
        WHERE lower(c.email) = lower(e.work_email)
      )
    ON CONFLICT (email) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;

  INSERT INTO public.audit_runs (run_id, invariant_key, severity, source, model, details, run_at)
  VALUES (
    gen_random_uuid(),
    'phase_2_5_backfill_contacts_from_employees',
    'ok',
    'supabase',
    'migration',
    jsonb_build_object('inserted_count', v_count),
    now()
  );
END $$;

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed)
VALUES ('create_trigger', 'odoo_employees',
        'Fase 2.5 — trigger trg_backfill_contact_from_employee: auto-crear contact cuando llega employee con work_email. Backfill historico aplicado.',
        'CREATE OR REPLACE FUNCTION public.trg_backfill_contact_from_employee() ... CREATE TRIGGER ...');

COMMIT;
