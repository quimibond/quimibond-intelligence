BEGIN;

CREATE OR REPLACE VIEW public.orders_unified AS
SELECT
  'sale'::text AS order_type,
  so.id,
  so.odoo_order_id,
  so.name,
  so.company_id,
  so.odoo_partner_id,
  so.amount_total,
  so.amount_untaxed,
  so.state,
  so.date_order,
  so.commitment_date AS fulfillment_date,
  so.currency,
  so.salesperson_user_id AS assignee_user_id,
  so.salesperson_name AS assignee_name,
  so.team_name,
  so.margin,
  so.margin_percent
FROM public.odoo_sale_orders so
UNION ALL
SELECT
  'purchase'::text AS order_type,
  po.id,
  po.odoo_order_id,
  po.name,
  po.company_id,
  po.odoo_partner_id,
  po.amount_total,
  po.amount_untaxed,
  po.state,
  po.date_order,
  po.date_approve AS fulfillment_date,
  po.currency,
  po.buyer_user_id AS assignee_user_id,
  po.buyer_name AS assignee_name,
  NULL::text AS team_name,
  NULL::numeric AS margin,
  NULL::numeric AS margin_percent
FROM public.odoo_purchase_orders po;

COMMENT ON VIEW public.orders_unified IS
  'Unified sale + purchase orders con discriminador order_type. Columnas comunes.';

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed)
VALUES ('create_view', 'orders_unified', 'Fase 2.5 — union sale+purchase orders con assignee_user_id comun',
        'CREATE OR REPLACE VIEW public.orders_unified AS ...');

COMMIT;
