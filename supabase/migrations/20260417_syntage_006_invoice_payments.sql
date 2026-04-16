-- Syntage Fase 1 · Migration 006 — Complementos de Pago (CFDI Tipo P)

CREATE TABLE public.syntage_invoice_payments (
  syntage_id              text PRIMARY KEY,
  uuid_complemento        text UNIQUE NOT NULL,
  taxpayer_rfc            text NOT NULL,
  odoo_company_id         int,
  direction               text NOT NULL CHECK (direction IN ('issued','received')),

  fecha_pago              timestamptz,
  forma_pago_p            text,
  moneda_p                text,
  tipo_cambio_p           numeric(18,6),
  monto                   numeric(18,2),
  num_operacion           text,
  rfc_emisor_cta_ord      text,
  rfc_emisor_cta_ben      text,

  doctos_relacionados     jsonb,

  estado_sat              text DEFAULT 'vigente'
                          CHECK (estado_sat IN
                            ('vigente','cancelado','cancelacion_pendiente')),

  xml_file_id             bigint REFERENCES public.syntage_files(id)
                          ON DELETE SET NULL,

  raw_payload             jsonb,
  source_id               bigint,
  source_ref              text,
  synced_at               timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_syntage_payments_taxpayer_date
  ON public.syntage_invoice_payments (taxpayer_rfc, fecha_pago DESC);
CREATE INDEX idx_syntage_payments_num_op
  ON public.syntage_invoice_payments (num_operacion);
CREATE INDEX idx_syntage_payments_doctos_gin
  ON public.syntage_invoice_payments USING gin (doctos_relacionados);

ALTER TABLE public.syntage_invoice_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.syntage_invoice_payments FROM anon, authenticated;

COMMENT ON TABLE public.syntage_invoice_payments IS
  'CFDI Type P (complementos de pago). doctos_relacionados explodes to [{uuid_docto, parcialidad, imp_pagado, imp_saldo_insoluto}].';
