BEGIN;

CREATE MATERIALIZED VIEW IF NOT EXISTS public.product_price_history AS
WITH order_sale AS (
  SELECT odoo_product_id,
         date_trunc('month', order_date)::date AS month,
         'order_sale'::text AS source,
         avg(price_unit) AS avg_price,
         min(price_unit) AS min_price,
         max(price_unit) AS max_price,
         sum(qty) AS qty,
         count(*) AS line_count,
         count(DISTINCT company_id) AS companies_count
  FROM public.odoo_order_lines
  WHERE order_type='sale' AND order_state IN ('sale','done') AND odoo_product_id IS NOT NULL
  GROUP BY 1, 2
),
order_purchase AS (
  SELECT odoo_product_id,
         date_trunc('month', order_date)::date AS month,
         'order_purchase'::text AS source,
         avg(price_unit) AS avg_price,
         min(price_unit) AS min_price,
         max(price_unit) AS max_price,
         sum(qty) AS qty,
         count(*) AS line_count,
         count(DISTINCT company_id) AS companies_count
  FROM public.odoo_order_lines
  WHERE order_type='purchase' AND order_state IN ('purchase','done') AND odoo_product_id IS NOT NULL
  GROUP BY 1, 2
),
invoice_sale AS (
  SELECT odoo_product_id,
         date_trunc('month', invoice_date)::date AS month,
         'invoice_sale'::text AS source,
         avg(price_unit) AS avg_price,
         min(price_unit) AS min_price,
         max(price_unit) AS max_price,
         sum(quantity) AS qty,
         count(*) AS line_count,
         count(DISTINCT company_id) AS companies_count
  FROM public.odoo_invoice_lines
  WHERE move_type IN ('out_invoice','out_refund') AND odoo_product_id IS NOT NULL
  GROUP BY 1, 2
),
invoice_purchase AS (
  SELECT odoo_product_id,
         date_trunc('month', invoice_date)::date AS month,
         'invoice_purchase'::text AS source,
         avg(price_unit) AS avg_price,
         min(price_unit) AS min_price,
         max(price_unit) AS max_price,
         sum(quantity) AS qty,
         count(*) AS line_count,
         count(DISTINCT company_id) AS companies_count
  FROM public.odoo_invoice_lines
  WHERE move_type IN ('in_invoice','in_refund') AND odoo_product_id IS NOT NULL
  GROUP BY 1, 2
)
SELECT odoo_product_id, month, source, avg_price, min_price, max_price, qty, line_count, companies_count FROM order_sale
UNION ALL SELECT odoo_product_id, month, source, avg_price, min_price, max_price, qty, line_count, companies_count FROM order_purchase
UNION ALL SELECT odoo_product_id, month, source, avg_price, min_price, max_price, qty, line_count, companies_count FROM invoice_sale
UNION ALL SELECT odoo_product_id, month, source, avg_price, min_price, max_price, qty, line_count, companies_count FROM invoice_purchase;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pph_pk ON public.product_price_history (odoo_product_id, month, source);
CREATE INDEX IF NOT EXISTS idx_pph_month ON public.product_price_history (month);
CREATE INDEX IF NOT EXISTS idx_pph_source ON public.product_price_history (source);

COMMENT ON MATERIALIZED VIEW public.product_price_history IS
  'Historial mensual de precios por producto (sale/purchase × order/invoice). Refreshed en refresh_all_matviews.';

-- Actualizar refresh_all_matviews para incluir product_price_history.
-- safe_refresh_mv no existe en este proyecto — se usa REFRESH directo.
CREATE OR REPLACE FUNCTION public.refresh_all_matviews()
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.company_profile;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.company_profile_sat;
  REFRESH MATERIALIZED VIEW monthly_revenue_by_company;
  REFRESH MATERIALIZED VIEW portfolio_concentration;
  REFRESH MATERIALIZED VIEW ar_aging_detail;
  REFRESH MATERIALIZED VIEW accounting_anomalies;
  REFRESH MATERIALIZED VIEW customer_cohorts;
  REFRESH MATERIALIZED VIEW customer_margin_analysis;
  REFRESH MATERIALIZED VIEW customer_product_matrix;
  REFRESH MATERIALIZED VIEW supplier_product_matrix;
  REFRESH MATERIALIZED VIEW dead_stock_analysis;
  REFRESH MATERIALIZED VIEW inventory_velocity;
  REFRESH MATERIALIZED VIEW ops_delivery_health_weekly;
  REFRESH MATERIALIZED VIEW product_real_cost;
  REFRESH MATERIALIZED VIEW product_margin_analysis;
  REFRESH MATERIALIZED VIEW product_seasonality;
  REFRESH MATERIALIZED VIEW purchase_price_intelligence;
  REFRESH MATERIALIZED VIEW supplier_concentration_herfindahl;
  REFRESH MATERIALIZED VIEW company_email_intelligence;
  REFRESH MATERIALIZED VIEW company_handlers;
  REFRESH MATERIALIZED VIEW company_insight_history;
  REFRESH MATERIALIZED VIEW cross_director_signals;
  REFRESH MATERIALIZED VIEW cashflow_projection;
  REFRESH MATERIALIZED VIEW real_sale_price;
  REFRESH MATERIALIZED VIEW supplier_price_index;
  REFRESH MATERIALIZED VIEW company_narrative;
  REFRESH MATERIALIZED VIEW customer_ltv_health;
  REFRESH MATERIALIZED VIEW payment_predictions;
  REFRESH MATERIALIZED VIEW client_reorder_predictions;
  REFRESH MATERIALIZED VIEW rfm_segments;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.journal_flow_profile;
  REFRESH MATERIALIZED VIEW public.products_unified;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.product_price_history;
  RAISE NOTICE 'All 33 materialized views refreshed successfully';
END;
$function$;

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed)
VALUES ('create_matview','product_price_history','Fase 2.5 — historial precios mensual por SKU/source + hook en refresh_all_matviews','CREATE MATERIALIZED VIEW + 3 indexes + update refresh_all_matviews');

COMMIT;
