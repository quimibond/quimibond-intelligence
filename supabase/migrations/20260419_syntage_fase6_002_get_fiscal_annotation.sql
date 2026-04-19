-- Fase 6 · 002: función PL/pgSQL determinística para fiscal annotation.
-- Recibe company_id, devuelve JSONB con flag prioritizado o NULL.
-- Prioridad: partner_blacklist_69b > cancelled_but_posted > sat_only_cfdi_issued(critical)
--         > payment_missing_complemento.

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
  )
  SELECT CASE
    WHEN w.issue_id IS NULL THEN NULL
    ELSE jsonb_build_object(
      'flag',        w.issue_type,
      'severity',    w.severity,
      'issue_count', (SELECT count(*) FROM public.reconciliation_issues
                      WHERE company_id = p_company_id AND resolved_at IS NULL),
      'detail',      w.description,
      'issue_ids',   (SELECT array_agg(issue_id::text ORDER BY issue_id::text)
                      FROM public.reconciliation_issues
                      WHERE company_id = p_company_id AND resolved_at IS NULL)
    )
  END
  FROM winner w;
$$;

-- service_role necesita ejecutarla desde el post-filter Node.
GRANT EXECUTE ON FUNCTION public.get_fiscal_annotation(bigint) TO service_role;

COMMENT ON FUNCTION public.get_fiscal_annotation(bigint) IS
  'Fase 6: devuelve flag fiscal prioritario para una company_id con issues open en reconciliation_issues. Usado por applyFiscalAnnotation() en orchestrate pre-INSERT.';
