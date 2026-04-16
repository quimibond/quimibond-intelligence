-- Syntage Fase 1 · Migration 004 — syntage_invoices
-- Core table: CFDIs tipo I (Ingreso) + E (Egreso), issued and received.

CREATE TABLE public.syntage_invoices (
  syntage_id                    text PRIMARY KEY,
  uuid                          text UNIQUE NOT NULL,
  taxpayer_rfc                  text NOT NULL,
  odoo_company_id               int,
  direction                     text NOT NULL CHECK (direction IN ('issued', 'received')),

  tipo_comprobante              text,
  serie                         text,
  folio                         text,
  fecha_emision                 timestamptz,
  fecha_timbrado                timestamptz,

  emisor_rfc                    text,
  emisor_nombre                 text,
  receptor_rfc                  text,
  receptor_nombre               text,

  subtotal                      numeric(18,2),
  descuento                     numeric(18,2),
  total                         numeric(18,2),
  moneda                        text,
  tipo_cambio                   numeric(18,6) DEFAULT 1,
  total_mxn                     numeric(18,2) GENERATED ALWAYS AS
                                (total * COALESCE(tipo_cambio, 1)) STORED,

  impuestos_trasladados         numeric(18,2),
  impuestos_retenidos           numeric(18,2),

  metodo_pago                   text,
  forma_pago                    text,
  uso_cfdi                      text,

  estado_sat                    text DEFAULT 'vigente'
                                CHECK (estado_sat IN
                                  ('vigente','cancelado','cancelacion_pendiente')),
  fecha_cancelacion             timestamptz,

  emisor_blacklist_status       text,
  receptor_blacklist_status     text,

  xml_file_id                   bigint REFERENCES public.syntage_files(id)
                                ON DELETE SET NULL,
  pdf_file_id                   bigint REFERENCES public.syntage_files(id)
                                ON DELETE SET NULL,

  company_id                    bigint REFERENCES public.companies(id)
                                ON DELETE SET NULL,

  raw_payload                   jsonb,
  source_id                     bigint,
  source_ref                    text,
  synced_at                     timestamptz NOT NULL DEFAULT now(),
  created_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_syntage_invoices_taxpayer_dir_date
  ON public.syntage_invoices (taxpayer_rfc, direction, fecha_emision DESC);
CREATE INDEX idx_syntage_invoices_company
  ON public.syntage_invoices (company_id);
CREATE INDEX idx_syntage_invoices_odoo_company
  ON public.syntage_invoices (odoo_company_id);
CREATE INDEX idx_syntage_invoices_cancelled
  ON public.syntage_invoices (estado_sat, fecha_cancelacion DESC)
  WHERE estado_sat = 'cancelado';

ALTER TABLE public.syntage_invoices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.syntage_invoices FROM anon, authenticated;

COMMENT ON TABLE public.syntage_invoices IS
  'CFDIs I/E from SAT via Syntage. uuid is join key with odoo_invoices.cfdi_uuid.';

-- Trigger: auto-link company_id vía RFC (counterparty, no nuestra entidad)
CREATE OR REPLACE FUNCTION public.auto_link_syntage_invoice_company()
RETURNS TRIGGER AS $$
DECLARE
  v_counterparty_rfc text;
BEGIN
  v_counterparty_rfc := CASE
    WHEN NEW.direction = 'received' THEN NEW.emisor_rfc
    WHEN NEW.direction = 'issued'   THEN NEW.receptor_rfc
  END;

  IF v_counterparty_rfc IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO NEW.company_id
  FROM public.companies
  WHERE lower(rfc) = lower(v_counterparty_rfc)
  LIMIT 1;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

CREATE TRIGGER trg_auto_link_syntage_invoice_company
BEFORE INSERT OR UPDATE OF emisor_rfc, receptor_rfc, direction
ON public.syntage_invoices
FOR EACH ROW
EXECUTE FUNCTION public.auto_link_syntage_invoice_company();

COMMENT ON FUNCTION public.auto_link_syntage_invoice_company() IS
  'Populates company_id by matching counterparty RFC against companies.rfc.';
