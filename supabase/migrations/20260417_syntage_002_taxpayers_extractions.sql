-- Syntage Fase 1 · Migration 002 — plumbing tables
-- taxpayers: espejo de /taxpayers en Syntage (una row por entidad)
-- extractions: log de tareas de extracción (status + timing)

CREATE TABLE public.syntage_taxpayers (
  rfc                 text PRIMARY KEY,
  person_type         text CHECK (person_type IN ('physical', 'legal')),
  name                text,
  registration_date   date,
  raw_payload         jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.syntage_taxpayers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.syntage_taxpayers FROM anon, authenticated;

COMMENT ON TABLE public.syntage_taxpayers IS
  'Mirror of Syntage taxpayers. One row per Quimibond entity configured in Syntage.';

CREATE TABLE public.syntage_extractions (
  syntage_id          text PRIMARY KEY,
  taxpayer_rfc        text NOT NULL REFERENCES public.syntage_taxpayers(rfc),
  odoo_company_id     int,
  extractor_type      text NOT NULL,
  options             jsonb,
  status              text NOT NULL CHECK (status IN
                        ('pending','waiting','running','finished','failed','stopping','stopped','cancelled')),
  started_at          timestamptz,
  finished_at         timestamptz,
  rows_produced       int DEFAULT 0,
  error               text,
  raw_payload         jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_syntage_extractions_taxpayer_status
  ON public.syntage_extractions (taxpayer_rfc, status, started_at DESC);

ALTER TABLE public.syntage_extractions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.syntage_extractions FROM anon, authenticated;

COMMENT ON TABLE public.syntage_extractions IS
  'Log of Syntage extraction jobs. Used for backfill progress tracking and debugging.';
