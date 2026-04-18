-- Fase 5 PR 5 · Deprecate cfdi_documents (rename for 30d safety net)

ALTER TABLE IF EXISTS public.cfdi_documents RENAME TO cfdi_documents_deprecated_20260420;

-- Make read-only: revoke DML from PUBLIC and service_role
REVOKE INSERT, UPDATE, DELETE ON public.cfdi_documents_deprecated_20260420 FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.cfdi_documents_deprecated_20260420 FROM service_role;

COMMENT ON TABLE public.cfdi_documents_deprecated_20260420 IS 'Deprecated 2026-04-20 · read-only · replaced by email_cfdi_links. DROP en Fase 5 PR 6 (día 30).';
