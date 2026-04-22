-- Migration: 1071b_silver_sp5_physical_drop_cron_cleanup
-- Deactivate cron jobs that reference now-dropped objects (invoices_unified, payments_unified,
-- reconciliation_summary_daily), and drop the orphaned refresh functions.

BEGIN;

-- Unschedule cron jobs by name (uses pg_cron RPC — avoids direct table write)
SELECT cron.unschedule('refresh-syntage-unified');
SELECT cron.unschedule('syntage-reconciliation-daily-snapshot');

-- Drop orphaned functions that reference the dropped MVs
DROP FUNCTION IF EXISTS public.refresh_invoices_unified() CASCADE;
DROP FUNCTION IF EXISTS public.refresh_payments_unified() CASCADE;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'DROP', 'multiple',
  'Unschedule cron jobs refresh-syntage-unified + syntage-reconciliation-daily-snapshot; drop orphaned refresh functions after SP5 T29 DROP',
  'SELECT cron.unschedule(...); DROP FUNCTION refresh_invoices_unified, refresh_payments_unified',
  'silver-sp5-task-29-cron-cleanup', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by='silver-sp5-task-29-cron-cleanup');

COMMIT;
