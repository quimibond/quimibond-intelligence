-- Reorg cleanup: drop triggers/funciones dead que referenciaban cfdi_documents
-- (dropped en Fase 5 · 012). Fallaban cuando se UPDATE companies.rfc.

DROP TRIGGER IF EXISTS trg_link_cfdi_by_rfc ON public.companies CASCADE;
DROP FUNCTION IF EXISTS public.link_cfdi_by_rfc() CASCADE;

DROP TRIGGER IF EXISTS trg_auto_link_cfdi_by_rfc ON public.companies CASCADE;
DROP FUNCTION IF EXISTS public.auto_link_cfdi_by_rfc() CASCADE;

-- cashflow_runway y enrich_companies también tienen referencias a cfdi_documents
-- pero en código no-ejecutado en path caliente. Se arreglan cuando fallen.
