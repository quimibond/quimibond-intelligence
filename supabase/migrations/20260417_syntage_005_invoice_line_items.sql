-- Syntage Fase 1 · Migration 005 — invoice line items (conceptos del CFDI)

CREATE TABLE public.syntage_invoice_line_items (
  syntage_id        text PRIMARY KEY,
  invoice_uuid      text NOT NULL REFERENCES public.syntage_invoices(uuid)
                    ON DELETE CASCADE,
  taxpayer_rfc      text NOT NULL,
  odoo_company_id   int,
  line_number       int,
  clave_prod_serv   text,
  descripcion       text,
  cantidad          numeric(18,4),
  clave_unidad      text,
  unidad            text,
  valor_unitario    numeric(18,4),
  importe           numeric(18,2),
  descuento         numeric(18,2),
  raw_payload       jsonb,
  source_id         bigint,
  source_ref        text,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_syntage_line_items_invoice
  ON public.syntage_invoice_line_items (invoice_uuid, line_number);
CREATE INDEX idx_syntage_line_items_clave_prod_serv
  ON public.syntage_invoice_line_items (clave_prod_serv);

ALTER TABLE public.syntage_invoice_line_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.syntage_invoice_line_items FROM anon, authenticated;
