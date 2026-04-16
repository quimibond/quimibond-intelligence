-- Syntage Fase 1 · Migration 007 — Retenciones + Declaraciones

CREATE TABLE public.syntage_tax_retentions (
  syntage_id                text PRIMARY KEY,
  uuid                      text UNIQUE NOT NULL,
  taxpayer_rfc              text NOT NULL,
  odoo_company_id           int,
  direction                 text NOT NULL CHECK (direction IN ('issued','received')),

  fecha_emision             timestamptz,
  emisor_rfc                text,
  emisor_nombre             text,
  receptor_rfc              text,
  receptor_nombre           text,

  tipo_retencion            text,
  monto_total_operacion     numeric(18,2),
  monto_total_gravado       numeric(18,2),
  monto_total_retenido      numeric(18,2),
  impuestos_retenidos       jsonb,

  estado_sat                text DEFAULT 'vigente',

  xml_file_id               bigint REFERENCES public.syntage_files(id)
                            ON DELETE SET NULL,

  raw_payload               jsonb,
  source_id                 bigint,
  source_ref                text,
  synced_at                 timestamptz NOT NULL DEFAULT now(),
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_syntage_retentions_taxpayer
  ON public.syntage_tax_retentions (taxpayer_rfc, fecha_emision DESC);

ALTER TABLE public.syntage_tax_retentions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.syntage_tax_retentions FROM anon, authenticated;


CREATE TABLE public.syntage_tax_returns (
  syntage_id                text PRIMARY KEY,
  taxpayer_rfc              text NOT NULL,
  odoo_company_id           int,
  return_type               text NOT NULL CHECK (return_type IN
                              ('monthly','annual','rif')),
  ejercicio                 int NOT NULL,
  periodo                   text NOT NULL,
  impuesto                  text,
  fecha_presentacion        timestamptz,
  monto_pagado              numeric(18,2),
  tipo_declaracion          text DEFAULT 'normal'
                            CHECK (tipo_declaracion IN
                              ('normal','complementaria')),
  numero_operacion          text,
  pdf_file_id               bigint REFERENCES public.syntage_files(id)
                            ON DELETE SET NULL,
  raw_payload               jsonb,
  source_id                 bigint,
  source_ref                text,
  synced_at                 timestamptz NOT NULL DEFAULT now(),
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (taxpayer_rfc, return_type, ejercicio, periodo, impuesto,
          tipo_declaracion, numero_operacion)
);

CREATE INDEX idx_syntage_tax_returns_lookup
  ON public.syntage_tax_returns (taxpayer_rfc, ejercicio, periodo);

ALTER TABLE public.syntage_tax_returns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.syntage_tax_returns FROM anon, authenticated;
