-- Cleanup cron para reconciliation_issues. Borra resueltos >30d.
-- UI solo lee resolved <14d (inbox.ts: closedThisWeek, closedTwoWeeksAgo,
-- avgResponseHours). Retencion de 30d es generosa.
-- Hoy borra 0 filas (tabla con 11 dias de vida); mantiene tabla bounded a futuro.
-- Mismo patron que audit_runs_retention_cleanup (90d, ya activo).
-- manual_notes NO se borra (tabla separada de evidencia humana).

SELECT cron.schedule(
  'recon_issues_retention_cleanup',
  '15 4 * * *',  -- 4:15 UTC daily, after silver_sp2_refresh_canonical_nightly (3:30)
  $$DELETE FROM public.reconciliation_issues
    WHERE resolved_at IS NOT NULL
      AND resolved_at < now() - interval '30 days'$$
);
