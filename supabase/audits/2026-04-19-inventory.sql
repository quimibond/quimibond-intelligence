-- Inventory query: clasifica tablas de public schema por layer convention
SELECT
  CASE
    WHEN table_name LIKE 'odoo_%'      THEN 'L1-raw-odoo'
    WHEN table_name LIKE 'syntage_%'   THEN 'L1-raw-syntage'
    WHEN table_name LIKE 'unified_%'   THEN 'L3-unified'
    WHEN table_name LIKE 'analytics_%' THEN 'L4-analytics'
    WHEN table_name LIKE 'agent_%'
      OR table_name LIKE 'ai_%'        THEN 'L5-intelligence'
    WHEN table_name LIKE 'dq_%'        THEN 'DQ'
    ELSE 'L2-canonical-or-legacy'
  END AS layer,
  table_type,
  table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY 1, 3;
