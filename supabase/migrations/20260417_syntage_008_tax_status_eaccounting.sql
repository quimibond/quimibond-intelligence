-- Syntage Fase 1 · Migration 008 — Tax status + e-accounting

CREATE TABLE public.syntage_tax_status (
  syntage_id                  text PRIMARY KEY,
  taxpayer_rfc                text NOT NULL,
  odoo_company_id             int,
  target_rfc                  text NOT NULL,
  fecha_consulta              timestamptz,
  opinion_cumplimiento        text CHECK (opinion_cumplimiento IN
                                ('positiva','negativa','sin_opinion')),
  regimen_fiscal              text,
  domicilio_fiscal            jsonb,
  actividades_economicas      jsonb,
  pdf_file_id                 bigint REFERENCES public.syntage_files(id)
                              ON DELETE SET NULL,
  raw_payload                 jsonb,
  source_id                   bigint,
  source_ref                  text,
  synced_at                   timestamptz NOT NULL DEFAULT now(),
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_syntage_tax_status_target
  ON public.syntage_tax_status (target_rfc, fecha_consulta DESC);

ALTER TABLE public.syntage_tax_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.syntage_tax_status FROM anon, authenticated;


CREATE TABLE public.syntage_electronic_accounting (
  syntage_id          text PRIMARY KEY,
  taxpayer_rfc        text NOT NULL,
  odoo_company_id     int,
  record_type         text NOT NULL CHECK (record_type IN
                        ('balanza','catalogo_cuentas','polizas')),
  ejercicio           int NOT NULL,
  periodo             text NOT NULL,
  tipo_envio          text DEFAULT 'normal',
  hash                text,
  xml_file_id         bigint REFERENCES public.syntage_files(id)
                      ON DELETE SET NULL,
  raw_payload         jsonb,
  source_id           bigint,
  source_ref          text,
  synced_at           timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (taxpayer_rfc, record_type, ejercicio, periodo, tipo_envio)
);

ALTER TABLE public.syntage_electronic_accounting ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.syntage_electronic_accounting FROM anon, authenticated;
