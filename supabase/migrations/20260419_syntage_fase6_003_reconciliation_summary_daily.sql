-- Fase 6 · 003: snapshot diario para cálculo de delta 24h en briefing.
-- Poblada por pg_cron 6:15am (migración 004).

CREATE TABLE IF NOT EXISTS public.reconciliation_summary_daily (
  snapshot_date date PRIMARY KEY,
  total_open int NOT NULL,
  severity_counts jsonb NOT NULL,   -- {critical, high, medium, low}
  by_issue_type jsonb NOT NULL,     -- {sat_only_cfdi_issued: N, ...}
  tax_status_opinion text,          -- 'positive' | 'negative' | null (de opinion_cumplimiento)
  blacklist_69b_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.reconciliation_summary_daily TO service_role;

COMMENT ON TABLE public.reconciliation_summary_daily IS
  'Fase 6: snapshot diario agregado desde reconciliation_issues + syntage_tax_status. Poblada por pg_cron 6:15am UTC. Consumida por briefing diario para delta 24h.';
