BEGIN;

-- Silver SP3 §5.8 — canonical_employees view
-- Derived view over canonical_contacts + odoo_employees + odoo_users.
-- Filtered to contact_type IN ('internal_employee','internal_user').
--
-- Column adaptations vs spec:
--   e.active → e.is_active  (column is already named is_active in odoo_employees)

CREATE OR REPLACE VIEW canonical_employees AS
SELECT
  cc.id                              AS contact_id,
  cc.primary_email,
  cc.display_name,
  cc.canonical_name,
  cc.odoo_employee_id,
  cc.odoo_user_id,
  e.work_phone,
  e.job_title,
  e.job_name,
  e.department_name,
  e.department_id,
  cc.manager_canonical_contact_id,
  e.coach_name,
  COALESCE(e.is_active, true)        AS is_active,
  u.pending_activities_count,
  u.overdue_activities_count,
  (
    SELECT COUNT(*)
    FROM agent_insights ai
    WHERE ai.assignee_user_id = cc.odoo_user_id
      AND ai.state IN ('new', 'seen')
  )                                  AS open_insights_count,
  cc.created_at,
  cc.updated_at
FROM canonical_contacts cc
LEFT JOIN odoo_employees e ON e.odoo_employee_id = cc.odoo_employee_id
LEFT JOIN odoo_users    u ON u.odoo_user_id      = cc.odoo_user_id
WHERE cc.contact_type IN ('internal_employee', 'internal_user');

COMMENT ON VIEW canonical_employees IS
  'Silver SP3 §5.8. Derived view over canonical_contacts + HR data.';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES (
  'create_view',
  'canonical_employees',
  'SP3 Task 10: view definition',
  '20260423_sp3_10_canonical_employees_view.sql',
  'silver-sp3',
  true
);

COMMIT;
