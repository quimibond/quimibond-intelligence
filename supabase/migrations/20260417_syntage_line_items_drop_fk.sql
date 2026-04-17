-- Drop FK from syntage_invoice_line_items → syntage_invoices(uuid).
-- Syntage emits events out of order (line_items can arrive before their parent invoice),
-- and we don't want to reject events or rely on Syntage retries to fill the gap.
-- invoice_uuid remains indexed as a soft reference for joins.
ALTER TABLE public.syntage_invoice_line_items
  DROP CONSTRAINT IF EXISTS syntage_invoice_line_items_invoice_uuid_fkey;

COMMENT ON COLUMN public.syntage_invoice_line_items.invoice_uuid IS
  'Soft reference to syntage_invoices.uuid. Not a strict FK because Syntage may emit line_items before their parent invoice event.';
