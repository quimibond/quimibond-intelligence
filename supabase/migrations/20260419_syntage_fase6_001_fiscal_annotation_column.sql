-- Fase 6 · 001: agent_insights.fiscal_annotation JSONB
-- NULL-able. Poblada por applyFiscalAnnotation() pre-INSERT cuando company_id
-- tiene issues abiertos en reconciliation_issues.

ALTER TABLE public.agent_insights
  ADD COLUMN IF NOT EXISTS fiscal_annotation JSONB;

-- Index parcial para queries "insights con flag fiscal activo"
-- (Meta reconciliation semanal lo usa cada domingo).
CREATE INDEX IF NOT EXISTS idx_agent_insights_fiscal_annotation
  ON public.agent_insights ((fiscal_annotation->>'flag'))
  WHERE fiscal_annotation IS NOT NULL;

COMMENT ON COLUMN public.agent_insights.fiscal_annotation IS
  'Fase 6: flag fiscal determinístico inyectado por applyFiscalAnnotation() pre-INSERT. Forma: {flag, severity, issue_count, detail, issue_ids}. NULL si no hay match o si insight es de agent_slug=compliance.';
