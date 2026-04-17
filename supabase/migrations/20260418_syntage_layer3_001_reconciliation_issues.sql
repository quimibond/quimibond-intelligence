-- Fase 3 Layer 3 · 001 reconciliation_issues
-- Tabla de discrepancias entre Syntage (fiscal) y Odoo (operativo).
-- Poblada por refresh_invoices_unified() y refresh_payments_unified().

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS public.reconciliation_issues CASCADE;

CREATE TABLE public.reconciliation_issues (
  issue_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_type        text NOT NULL CHECK (issue_type IN (
    'cancelled_but_posted',
    'posted_but_sat_uncertified',
    'sat_only_cfdi_received',
    'sat_only_cfdi_issued',
    'amount_mismatch',
    'partner_blacklist_69b',
    'payment_missing_complemento',
    'complemento_missing_payment'
  )),
  canonical_id      text,
  uuid_sat          text,
  odoo_invoice_id   bigint,
  odoo_payment_id   bigint,
  odoo_company_id   integer,
  company_id        bigint,
  description       text NOT NULL,
  severity          text NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  detected_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  resolution        text,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX reconciliation_issues_open_unique
  ON public.reconciliation_issues (issue_type, canonical_id)
  WHERE resolved_at IS NULL;

CREATE INDEX reconciliation_issues_company_open_idx
  ON public.reconciliation_issues (odoo_company_id, severity)
  WHERE resolved_at IS NULL;

CREATE INDEX reconciliation_issues_detected_idx
  ON public.reconciliation_issues (detected_at DESC);

CREATE INDEX reconciliation_issues_resolved_at_idx
  ON public.reconciliation_issues (resolved_at DESC NULLS FIRST);

ALTER TABLE public.reconciliation_issues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.reconciliation_issues FROM anon, authenticated;
GRANT ALL ON public.reconciliation_issues TO service_role;

COMMENT ON TABLE public.reconciliation_issues IS 'Fase 3 · Discrepancias Syntage/Odoo detectadas por refresh_*_unified(). 8 tipos MVP. Spec: docs/superpowers/specs/2026-04-17-syntage-fase-3-layer-3-design.md §7.';

COMMENT ON INDEX public.reconciliation_issues_open_unique IS 'Dedup estructural de issues abiertos. PostgreSQL trata NULLs como distintos en UNIQUE, así que canonical_id NUNCA puede ser NULL al insertar — esto es invariante poblada por refresh_invoices_unified / refresh_payments_unified.';
