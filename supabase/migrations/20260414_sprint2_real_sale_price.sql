-- Sprint 2.1 — real_sale_price matview
-- Precio REAL de venta por producto calculado desde odoo_order_lines.
-- Reemplaza odoo_products.list_price (roto en 91% del catálogo: list < cost).

CREATE MATERIALIZED VIEW IF NOT EXISTS public.real_sale_price AS
WITH sale_lines AS (
  SELECT ol.odoo_product_id, ol.product_ref, ol.product_name,
         ol.price_unit, ol.qty, ol.subtotal_mxn, ol.order_date, ol.company_id
  FROM odoo_order_lines ol
  WHERE ol.order_type='sale' AND ol.price_unit>0 AND ol.qty>0
    AND ol.odoo_product_id IS NOT NULL
    AND ol.order_date >= CURRENT_DATE - INTERVAL '18 months'
), agg AS (
  SELECT
    odoo_product_id,
    MAX(product_ref) AS product_ref,
    MAX(product_name) AS product_name,
    SUM(price_unit * qty) FILTER (WHERE order_date >= CURRENT_DATE - INTERVAL '90 days')
      / NULLIF(SUM(qty) FILTER (WHERE order_date >= CURRENT_DATE - INTERVAL '90 days'),0) AS price_90d,
    SUM(price_unit * qty) FILTER (WHERE order_date >= CURRENT_DATE - INTERVAL '180 days')
      / NULLIF(SUM(qty) FILTER (WHERE order_date >= CURRENT_DATE - INTERVAL '180 days'),0) AS price_180d,
    SUM(price_unit * qty) FILTER (WHERE order_date >= CURRENT_DATE - INTERVAL '365 days')
      / NULLIF(SUM(qty) FILTER (WHERE order_date >= CURRENT_DATE - INTERVAL '365 days'),0) AS price_12m,
    MIN(price_unit) FILTER (WHERE order_date >= CURRENT_DATE - INTERVAL '365 days') AS min_price_12m,
    MAX(price_unit) FILTER (WHERE order_date >= CURRENT_DATE - INTERVAL '365 days') AS max_price_12m,
    STDDEV(price_unit) FILTER (WHERE order_date >= CURRENT_DATE - INTERVAL '365 days') AS stddev_12m,
    SUM(qty) FILTER (WHERE order_date >= CURRENT_DATE - INTERVAL '90 days') AS qty_sold_90d,
    SUM(qty) FILTER (WHERE order_date >= CURRENT_DATE - INTERVAL '365 days') AS qty_sold_12m,
    SUM(subtotal_mxn) FILTER (WHERE order_date >= CURRENT_DATE - INTERVAL '365 days') AS revenue_12m,
    COUNT(DISTINCT company_id) FILTER (WHERE order_date >= CURRENT_DATE - INTERVAL '365 days') AS customers_12m,
    COUNT(*) AS sale_lines_12m,
    MAX(order_date) AS last_sale_date
  FROM sale_lines GROUP BY odoo_product_id
)
SELECT
  a.odoo_product_id, a.product_ref, a.product_name,
  COALESCE(a.price_90d, a.price_180d, a.price_12m) AS price_current,
  a.price_90d, a.price_180d, a.price_12m,
  a.min_price_12m, a.max_price_12m, a.stddev_12m,
  CASE WHEN a.price_12m > 0 THEN ROUND((a.stddev_12m / a.price_12m)::numeric, 3) ELSE NULL END AS cv_12m,
  a.qty_sold_90d, a.qty_sold_12m, a.revenue_12m, a.customers_12m, a.sale_lines_12m, a.last_sale_date,
  p.standard_price AS odoo_cost,
  CASE WHEN p.standard_price > 0 AND COALESCE(a.price_90d, a.price_12m) > 0
       THEN ROUND(((COALESCE(a.price_90d, a.price_12m) - p.standard_price) / p.standard_price * 100)::numeric, 1)
       ELSE NULL END AS markup_vs_cost_pct,
  CASE WHEN p.list_price > 0 AND COALESCE(a.price_90d, a.price_12m) > 0
            AND ABS(p.list_price - COALESCE(a.price_90d, a.price_12m)) / COALESCE(a.price_90d, a.price_12m) > 0.30
       THEN true ELSE false END AS list_price_is_stale,
  NOW() AS computed_at
FROM agg a
LEFT JOIN odoo_products p ON p.odoo_product_id = a.odoo_product_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_real_sale_price_pk ON public.real_sale_price (odoo_product_id);
CREATE INDEX IF NOT EXISTS idx_real_sale_price_ref ON public.real_sale_price (product_ref);
CREATE INDEX IF NOT EXISTS idx_real_sale_price_revenue ON public.real_sale_price (revenue_12m DESC NULLS LAST);

COMMENT ON MATERIALIZED VIEW public.real_sale_price IS
'Precio de venta REAL calculado desde odoo_order_lines (promedio ponderado por cantidad, ventanas 90d/180d/12m). Reemplaza odoo_products.list_price que está roto en 91% del catálogo.';

CREATE OR REPLACE FUNCTION public.refresh_real_sale_price()
RETURNS void LANGUAGE sql AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.real_sale_price;
$$;
