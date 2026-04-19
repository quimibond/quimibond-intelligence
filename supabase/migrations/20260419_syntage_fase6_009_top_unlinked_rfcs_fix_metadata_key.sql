-- Fase 6 · 009: fix syntage_top_unlinked_rfcs para usar metadata->>'counterparty_rfc'
-- El metadata real en Fase 3 refresh usa 'counterparty_rfc', no 'emisor_rfc' ni 'rfc'.
-- Descubierto en audit post-deploy: todos los 4,309 rows sat_only_cfdi_received unlinked
-- agrupaban bajo '—unknown—'. Fix: extraer desde metadata->>'counterparty_rfc'.

CREATE OR REPLACE FUNCTION public.syntage_top_unlinked_rfcs(p_limit int DEFAULT 10)
RETURNS TABLE(rfc text, cnt int, last_seen date)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    COALESCE(metadata->>'counterparty_rfc', '—unknown—') AS rfc,
    count(*)::int AS cnt,
    max(detected_at::date) AS last_seen
  FROM public.reconciliation_issues
  WHERE issue_type = 'sat_only_cfdi_received'
    AND company_id IS NULL
    AND resolved_at IS NULL
  GROUP BY 1
  ORDER BY cnt DESC
  LIMIT p_limit;
$$;
