-- Syntage · Agrega odoo_invoice_id a odoo_invoices
--
-- Bug encontrado: odoo_invoices.id es un IDENTITY bigint auto-generado por
-- Supabase, NO el ID nativo de account.move en Odoo. Sin exponer el ID nativo
-- no podemos joinear con odoo_payment_invoice_links (que usa inv.id desde
-- el addon).
--
-- Populado por qb19 _push_invoices(): cada row incluye 'odoo_invoice_id': inv.id.

ALTER TABLE public.odoo_invoices
  ADD COLUMN IF NOT EXISTS odoo_invoice_id integer;

CREATE UNIQUE INDEX IF NOT EXISTS odoo_invoices_odoo_invoice_id_key
  ON public.odoo_invoices (odoo_invoice_id)
  WHERE odoo_invoice_id IS NOT NULL;

COMMENT ON COLUMN public.odoo_invoices.odoo_invoice_id IS
  'ID nativo de account.move en Odoo. Habilita join Syntage↔Odoo payments via CFDI UUID.';
