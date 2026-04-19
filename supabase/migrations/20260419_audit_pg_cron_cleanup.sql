-- Job diario que borra audit_runs viejos (>90 días)
SELECT cron.schedule(
  'audit_runs_retention_cleanup',
  '30 3 * * *',  -- diario 03:30 UTC
  $$ DELETE FROM audit_runs WHERE run_at < now() - interval '90 days'; $$
);
