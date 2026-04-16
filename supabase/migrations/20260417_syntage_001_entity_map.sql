-- Syntage Fase 1 · Migration 001 — syntage_entity_map
-- Multi-tenant bridge: maps each Syntage taxpayer (by RFC) to its
-- corresponding Odoo res.company.id. This is the SINGLE source of truth
-- for "which Syntage events belong to which Quimibond entity".

CREATE TABLE public.syntage_entity_map (
  taxpayer_rfc      text PRIMARY KEY,
  odoo_company_id   int  UNIQUE NOT NULL,
  alias             text NOT NULL,
  is_active         bool NOT NULL DEFAULT true,
  backfill_from     date,
  priority          text NOT NULL DEFAULT 'secondary'
                    CHECK (priority IN ('primary', 'secondary')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_syntage_entity_map_active
  ON public.syntage_entity_map (taxpayer_rfc) WHERE is_active = true;

-- RLS: deny all by default, service_role only
ALTER TABLE public.syntage_entity_map ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.syntage_entity_map FROM anon, authenticated;

COMMENT ON TABLE public.syntage_entity_map IS
  'Bridge between Syntage taxpayers (RFC) and Odoo companies. Populated manually. Webhook handler rejects unmapped RFCs.';
