-- Fase 3 Layer 3 · 005 get_syntage_reconciliation_summary
-- Single-roundtrip JSON para el dashboard UI.

CREATE OR REPLACE FUNCTION public.get_syntage_reconciliation_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH
    open_issues AS (
      SELECT * FROM public.reconciliation_issues WHERE resolved_at IS NULL
    ),
    by_type_cte AS (
      SELECT
        issue_type,
        count(*) AS open,
        (SELECT count(*) FROM public.reconciliation_issues
          WHERE issue_type = o.issue_type
            AND resolved_at > now() - interval '7 days') AS resolved_7d,
        -- Rank por peso, luego convertir de nuevo a texto
        (ARRAY['low','medium','high','critical'])[
          max(CASE severity
                WHEN 'low' THEN 1
                WHEN 'medium' THEN 2
                WHEN 'high' THEN 3
                WHEN 'critical' THEN 4
              END)
        ] AS severity
      FROM open_issues o
      GROUP BY issue_type
    ),
    by_severity_cte AS (
      SELECT jsonb_object_agg(severity, cnt) AS severity_map
      FROM (
        SELECT severity, count(*) AS cnt FROM open_issues GROUP BY severity
      ) s
    ),
    top_companies_cte AS (
      SELECT jsonb_agg(jsonb_build_object(
        'company_id', c.id,
        'name', c.name,
        'open', t.n
      ) ORDER BY t.n DESC) AS companies
      FROM (
        SELECT company_id, count(*) AS n
        FROM open_issues
        WHERE company_id IS NOT NULL
        GROUP BY company_id
        ORDER BY n DESC
        LIMIT 10
      ) t
      LEFT JOIN public.companies c ON c.id = t.company_id
    ),
    resolution_rate_cte AS (
      SELECT
        CASE
          WHEN (resolved_last_7d + opened_last_7d) = 0 THEN 0::numeric
          ELSE round(resolved_last_7d::numeric / (resolved_last_7d + opened_last_7d), 2)
        END AS rate
      FROM (
        SELECT
          (SELECT count(*) FROM public.reconciliation_issues
            WHERE resolved_at > now() - interval '7 days') AS resolved_last_7d,
          (SELECT count(*) FROM public.reconciliation_issues
            WHERE detected_at > now() - interval '7 days') AS opened_last_7d
      ) x
    ),
    recent_critical_cte AS (
      SELECT jsonb_agg(jsonb_build_object(
        'issue_id', r.issue_id,
        'type', r.issue_type,
        'description', r.description,
        'severity', r.severity,
        'company', c.name,
        'company_id', r.company_id,
        'odoo_invoice_id', r.odoo_invoice_id,
        'uuid_sat', r.uuid_sat,
        'amount_diff', r.metadata->>'amount_diff',
        'detected_at', r.detected_at
      ) ORDER BY r.detected_at DESC) AS issues
      FROM (
        SELECT * FROM open_issues
        WHERE severity IN ('critical','high')
        ORDER BY detected_at DESC
        LIMIT 20
      ) r
      LEFT JOIN public.companies c ON c.id = r.company_id
    )
  SELECT jsonb_build_object(
    'by_type', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'type', issue_type,
        'open', open,
        'resolved_7d', resolved_7d,
        'severity', severity
      )) FROM by_type_cte
    ), '[]'::jsonb),
    'by_severity', COALESCE((SELECT severity_map FROM by_severity_cte),
                            '{"critical":0,"high":0,"medium":0,"low":0}'::jsonb),
    'top_companies', COALESCE((SELECT companies FROM top_companies_cte), '[]'::jsonb),
    'resolution_rate_7d', (SELECT rate FROM resolution_rate_cte),
    'recent_critical', COALESCE((SELECT issues FROM recent_critical_cte), '[]'::jsonb),
    'generated_at', now(),
    'invoices_unified_refreshed_at', (SELECT max(refreshed_at) FROM public.invoices_unified),
    'payments_unified_refreshed_at', (SELECT max(refreshed_at) FROM public.payments_unified)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_syntage_reconciliation_summary() TO service_role;

COMMENT ON FUNCTION public.get_syntage_reconciliation_summary() IS 'Fase 3 · JSON único consumido por SyntageReconciliationPanel. Target <300ms.';
