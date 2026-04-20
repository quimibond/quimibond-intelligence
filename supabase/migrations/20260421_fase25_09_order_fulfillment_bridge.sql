BEGIN;

CREATE OR REPLACE VIEW public.order_fulfillment_bridge AS
SELECT
  ol.odoo_line_id,
  ol.order_type,
  ol.odoo_order_id,
  ol.order_name,
  ol.company_id,
  ol.odoo_partner_id,
  ol.odoo_product_id,
  ol.product_ref,
  ol.product_name,
  ol.qty,
  ol.qty_delivered,
  ol.qty_invoiced,
  (ol.qty - COALESCE(ol.qty_delivered, 0)) AS qty_pending_delivery,
  (ol.qty - COALESCE(ol.qty_invoiced, 0)) AS qty_pending_invoicing,
  ol.price_unit,
  ol.subtotal_mxn,
  ol.order_state,
  ol.order_date,
  CASE
    WHEN ol.qty_invoiced >= ol.qty THEN 'fully_invoiced'
    WHEN ol.qty_delivered >= ol.qty THEN 'delivered_not_invoiced'
    WHEN ol.qty_delivered > 0 THEN 'partial_delivery'
    ELSE 'open'
  END AS fulfillment_stage
FROM public.odoo_order_lines ol
WHERE ol.order_state IN ('sale', 'purchase', 'done');

COMMENT ON VIEW public.order_fulfillment_bridge IS
  'Bridge orden → entrega → facturación. fulfillment_stage categoriza el embudo.';

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed)
VALUES ('create_view', 'order_fulfillment_bridge',
        'Fase 2.5 — trazabilidad orden→entrega→factura por linea con fulfillment_stage',
        'CREATE OR REPLACE VIEW public.order_fulfillment_bridge AS ...');

COMMIT;
