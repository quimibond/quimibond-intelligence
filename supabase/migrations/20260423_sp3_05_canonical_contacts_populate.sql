-- SP3 Task 5: Populate canonical_contacts
-- Sources (in priority order):
--   5a. odoo_users (40 with email)     → internal_user
--   5b. odoo_employees (150 with email) → internal_employee (merged onto user row via ON CONFLICT DO UPDATE)
--   5c. contacts (2037 with email)     → external_customer / external_supplier / external_unresolved
-- UNIQUE constraint: uq_cct_primary_email ON (LOWER(primary_email))
-- distinct_emails_total pre-gate: 2,063 → expected total ≤ 2,063

BEGIN;

-- 5a. Insert internal_users first (highest priority)
INSERT INTO canonical_contacts (
  primary_email, display_name, canonical_name,
  odoo_user_id, contact_type,
  match_method, match_confidence, last_matched_at
)
SELECT
  LOWER(u.email),
  u.name,
  LOWER(u.name),
  u.odoo_user_id,
  'internal_user',
  'email_exact', 0.99, now()
FROM odoo_users u
WHERE u.email IS NOT NULL AND u.email <> ''
ON CONFLICT ((LOWER(primary_email))) DO NOTHING;

-- 5b. Insert internal_employees (merge onto existing user row if same email)
INSERT INTO canonical_contacts (
  primary_email, display_name, canonical_name,
  odoo_employee_id, department, role, contact_type,
  match_method, match_confidence, last_matched_at
)
SELECT
  LOWER(e.work_email),
  e.name,
  LOWER(e.name),
  e.odoo_employee_id,
  e.department_name,
  COALESCE(e.job_title, e.job_name),
  'internal_employee',
  'email_exact', 0.99, now()
FROM odoo_employees e
WHERE e.work_email IS NOT NULL AND e.work_email <> ''
ON CONFLICT ((LOWER(primary_email))) DO UPDATE SET
  odoo_employee_id = EXCLUDED.odoo_employee_id,
  department       = COALESCE(canonical_contacts.department, EXCLUDED.department),
  role             = COALESCE(canonical_contacts.role, EXCLUDED.role);

-- 5c. Insert external contacts
INSERT INTO canonical_contacts (
  primary_email, display_name, canonical_name,
  odoo_partner_id, canonical_company_id,
  is_customer, is_supplier, contact_type,
  match_method, match_confidence, last_matched_at
)
SELECT
  LOWER(c.email),
  c.name,
  LOWER(c.name),
  c.odoo_partner_id,
  (SELECT cc.id
     FROM canonical_companies cc
     JOIN companies comp ON comp.canonical_name = cc.canonical_name
    WHERE comp.id = c.company_id
    LIMIT 1),
  COALESCE(c.is_customer, false),
  COALESCE(c.is_supplier, false),
  CASE
    WHEN COALESCE(c.is_customer, false) THEN 'external_customer'
    WHEN COALESCE(c.is_supplier, false) THEN 'external_supplier'
    ELSE 'external_unresolved'
  END,
  'email_exact', 0.99, now()
FROM contacts c
WHERE c.email IS NOT NULL AND c.email <> ''
ON CONFLICT ((LOWER(primary_email))) DO NOTHING;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('populate','canonical_contacts',
        'SP3 Task 5: populate from odoo_users + employees + contacts',
        '20260423_sp3_05_canonical_contacts_populate.sql',
        'silver-sp3', true);

COMMIT;
