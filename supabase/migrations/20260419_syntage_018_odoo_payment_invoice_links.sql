-- Syntage · Link table account.payment ↔ account.move (invoices)
--
-- Expone la reconciliación m2m `reconciled_invoice_ids` de Odoo a Supabase.
-- Habilita matching Syntage↔Odoo payments via CFDI UUID:
--   Syntage.doctos_relacionados[].uuid_docto
--     → odoo_invoices.cfdi_uuid
--     → odoo_payment_invoice_links.odoo_invoice_id
--     → odoo_payment_invoice_links.odoo_payment_id
--     → odoo_account_payments
--
-- Populado por qb19 addon: _push_payment_invoice_links() en sync_push.py
-- (idempotente: DELETE por odoo_payment_id tocado, re-INSERT links actuales).

CREATE TABLE IF NOT EXISTS public.odoo_payment_invoice_links (
  id               bigserial PRIMARY KEY,
  odoo_payment_id  integer NOT NULL,
  odoo_invoice_id  integer NOT NULL,
  odoo_company_id  integer,
  synced_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS odoo_payment_invoice_links_pk_natural
  ON public.odoo_payment_invoice_links (odoo_payment_id, odoo_invoice_id);

CREATE INDEX IF NOT EXISTS odoo_payment_invoice_links_payment_idx
  ON public.odoo_payment_invoice_links (odoo_payment_id);

CREATE INDEX IF NOT EXISTS odoo_payment_invoice_links_invoice_idx
  ON public.odoo_payment_invoice_links (odoo_invoice_id);

ALTER TABLE public.odoo_payment_invoice_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.odoo_payment_invoice_links FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.odoo_payment_invoice_links TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.odoo_payment_invoice_links_id_seq TO service_role;

COMMENT ON TABLE public.odoo_payment_invoice_links IS
  'Link table para reconciliación account.payment ↔ account.move. Populado por qb19 _push_payment_invoice_links.';
