-- Fase 6 · 004: pg_cron para poblar reconciliation_summary_daily diario.
-- 06:15 UTC = 00:15 hora CDMX. Garantiza snapshot antes del briefing diario.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Limpiar job previo (idempotente)
DO $$
BEGIN
  PERFORM cron.unschedule(jobname)
  FROM cron.job
  WHERE jobname = 'syntage-reconciliation-daily-snapshot';
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Schedule nuevo
SELECT cron.schedule(
  'syntage-reconciliation-daily-snapshot',
  '15 6 * * *',
  $job$
    INSERT INTO public.reconciliation_summary_daily
      (snapshot_date, total_open, severity_counts, by_issue_type,
       tax_status_opinion, blacklist_69b_count)
    SELECT
      CURRENT_DATE,
      (SELECT count(*) FROM public.reconciliation_issues WHERE resolved_at IS NULL),
      COALESCE((SELECT jsonb_object_agg(severity, cnt)
        FROM (SELECT severity, count(*) AS cnt FROM public.reconciliation_issues
              WHERE resolved_at IS NULL GROUP BY severity) s), '{}'::jsonb),
      COALESCE((SELECT jsonb_object_agg(issue_type, cnt)
        FROM (SELECT issue_type, count(*) AS cnt FROM public.reconciliation_issues
              WHERE resolved_at IS NULL GROUP BY issue_type) t), '{}'::jsonb),
      (SELECT opinion_cumplimiento FROM public.syntage_tax_status
       ORDER BY fecha_consulta DESC NULLS LAST LIMIT 1),
      (SELECT count(*)::int FROM public.reconciliation_issues
       WHERE issue_type='partner_blacklist_69b' AND resolved_at IS NULL)
    ON CONFLICT (snapshot_date) DO UPDATE SET
      total_open = EXCLUDED.total_open,
      severity_counts = EXCLUDED.severity_counts,
      by_issue_type = EXCLUDED.by_issue_type,
      tax_status_opinion = EXCLUDED.tax_status_opinion,
      blacklist_69b_count = EXCLUDED.blacklist_69b_count;
  $job$
);

COMMENT ON EXTENSION pg_cron IS 'Fase 6 · schedule syntage-reconciliation-daily-snapshot @ 15 6 * * * (6:15 UTC)';
