-- Reorg R3.3: backfill companies.rfc desde reconciliation_issues.metadata.counterparty_rfc
-- Para companies con issues activos sin RFC pero el metadata sí lo trae.
-- Recovered 5 companies. Resto de 822 sin rfc no tienen issues activos → data
-- quality pendiente (separate sweep).

WITH candidates AS (
  SELECT DISTINCT ON (c.id) c.id, ri.metadata->>'counterparty_rfc' AS rfc_candidate
  FROM public.companies c
  JOIN public.reconciliation_issues ri ON ri.company_id = c.id
  WHERE (c.rfc IS NULL OR c.rfc='')
    AND ri.metadata->>'counterparty_rfc' IS NOT NULL
    AND ri.metadata->>'counterparty_rfc' <> ''
  ORDER BY c.id, ri.detected_at DESC
)
UPDATE public.companies c
SET rfc = cand.rfc_candidate, updated_at = now()
FROM candidates cand
WHERE c.id = cand.id AND (c.rfc IS NULL OR c.rfc='');
