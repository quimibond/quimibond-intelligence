-- Fase 6 · 008: cap issue_ids en get_fiscal_annotation a top 10 más recientes.
-- Descubierto en audit post-deploy 2026-04-19: SONIGAS tenía 542 UUIDs en el payload,
-- inflando agent_insight.fiscal_annotation a ~30KB cada uno.

CREATE OR REPLACE FUNCTION public.get_fiscal_annotation(p_company_id bigint)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH prioritized AS (
    SELECT
      CASE
        WHEN issue_type = 'partner_blacklist_69b'     THEN 1
        WHEN issue_type = 'cancelled_but_posted'      THEN 2
        WHEN issue_type = 'sat_only_cfdi_issued' AND severity='critical' THEN 3
        WHEN issue_type = 'payment_missing_complemento' THEN 4
        ELSE 99
      END AS priority,
      issue_type, severity, issue_id, description
    FROM public.reconciliation_issues
    WHERE company_id = p_company_id
      AND resolved_at IS NULL
  ),
  winner AS (
    SELECT * FROM prioritized
    WHERE priority < 99
    ORDER BY priority, severity DESC
    LIMIT 1
  ),
  top10_ids AS (
    SELECT array_agg(issue_id::text ORDER BY detected_at DESC) AS ids
    FROM (
      SELECT issue_id, detected_at
      FROM public.reconciliation_issues
      WHERE company_id = p_company_id AND resolved_at IS NULL
      ORDER BY detected_at DESC
      LIMIT 10
    ) t
  )
  SELECT CASE
    WHEN w.issue_id IS NULL THEN NULL
    ELSE jsonb_build_object(
      'flag',        w.issue_type,
      'severity',    w.severity,
      'issue_count', (SELECT count(*) FROM public.reconciliation_issues
                      WHERE company_id = p_company_id AND resolved_at IS NULL),
      'detail',      w.description,
      'issue_ids',   (SELECT ids FROM top10_ids)
    )
  END
  FROM winner w;
$$;

COMMENT ON FUNCTION public.get_fiscal_annotation(bigint) IS
  'Fase 6 · fix 008: issue_ids capado a top 10 más recientes (anterior traía todos los open — 500+ en casos como SONIGAS). issue_count mantiene el total real.';
