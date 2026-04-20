BEGIN;

CREATE OR REPLACE VIEW public.person_unified AS
WITH base AS (
  SELECT
    c.id AS contact_id,
    c.entity_id,
    lower(c.email) AS primary_email,
    c.name AS contact_name,
    NULL::text AS phone,
    NULL::text AS company_text,
    c.company_id,
    NULL::integer AS employee_odoo_id,
    NULL::text    AS employee_department,
    NULL::text    AS employee_job_title,
    NULL::integer AS user_odoo_id,
    'contact'::text AS origin
  FROM public.contacts c
  WHERE c.email IS NOT NULL AND c.email <> ''
  UNION ALL
  SELECT
    NULL, NULL,
    lower(e.work_email), e.name, e.work_phone, NULL, NULL,
    e.odoo_employee_id, e.department_name, e.job_title,
    e.odoo_user_id,
    'employee'::text
  FROM public.odoo_employees e
  WHERE e.work_email IS NOT NULL AND e.work_email <> ''
  UNION ALL
  SELECT
    NULL, NULL,
    lower(u.email), u.name, NULL, NULL, NULL,
    NULL, u.department, u.job_title,
    u.odoo_user_id,
    'user'::text
  FROM public.odoo_users u
  WHERE u.email IS NOT NULL AND u.email <> ''
)
SELECT
  primary_email,
  bool_or(origin = 'contact')  AS has_contact,
  bool_or(origin = 'employee') AS has_employee,
  bool_or(origin = 'user')     AS has_user,
  max(contact_id)       AS contact_id,
  max(entity_id)        AS entity_id,
  max(employee_odoo_id) AS employee_odoo_id,
  max(user_odoo_id)     AS user_odoo_id,
  coalesce(max(contact_name), max(company_text)) AS name,
  max(employee_department) AS department,
  max(employee_job_title)  AS job_title,
  max(company_id)          AS company_id,
  CASE
    WHEN bool_or(origin = 'employee') THEN 'employee'
    WHEN bool_or(origin = 'user')     THEN 'user'
    ELSE 'external'
  END AS role
FROM base
GROUP BY primary_email;

COMMENT ON VIEW public.person_unified IS
  'Personas unificadas por primary_email: contacts ∪ odoo_employees ∪ odoo_users. Role deriva del origen. contacts.phone/company no disponibles en schema actual.';

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed)
VALUES ('create_view', 'person_unified',
        'Fase 2.5 — union personas por email (contacts ∪ employees ∪ users). Adapted: contacts sin phone/company columns.',
        'CREATE OR REPLACE VIEW public.person_unified AS ...');

COMMIT;
