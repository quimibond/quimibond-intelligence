-- Sprint 2.4 — supplier_price_index matview
-- Índice de precio por (producto, proveedor, mes) vs benchmark del producto.
-- >100 = caro, <100 = barato. Flags: overpriced, above_market, aligned, below_market, single_source.

CREATE MATERIALIZED VIEW IF NOT EXISTS public.supplier_price_index AS
WITH purchase_lines AS (
  SELECT
    ol.odoo_product_id, ol.product_ref, ol.product_name,
    ol.company_id AS supplier_id, c.name AS supplier_name,
    DATE_TRUNC('month', ol.order_date)::date AS month,
    ol.qty, ol.price_unit, ol.order_date, ol.order_name, ol.currency
  FROM odoo_order_lines ol
  JOIN companies c ON c.id = ol.company_id
  WHERE ol.order_type = 'purchase' AND ol.price_unit > 0 AND ol.qty > 0
    AND ol.odoo_product_id IS NOT NULL
    AND ol.order_date >= CURRENT_DATE - INTERVAL '18 months'
),
benchmarks AS (
  SELECT
    odoo_product_id, month,
    SUM(price_unit * qty) / NULLIF(SUM(qty),0) AS product_avg_price_month,
    COUNT(DISTINCT supplier_id) AS suppliers_in_month,
    SUM(qty) AS product_qty_month
  FROM purchase_lines
  GROUP BY odoo_product_id, month
),
supplier_agg AS (
  SELECT
    pl.odoo_product_id, pl.product_ref, pl.product_name,
    pl.supplier_id, pl.supplier_name, pl.month,
    SUM(pl.price_unit * pl.qty) / NULLIF(SUM(pl.qty),0) AS supplier_avg_price,
    SUM(pl.qty) AS supplier_qty,
    SUM(pl.price_unit * pl.qty) AS supplier_spend,
    COUNT(*) AS supplier_lines,
    MAX(pl.order_date) AS last_po_date,
    (array_agg(pl.order_name ORDER BY pl.order_date DESC))[1] AS last_po_name
  FROM purchase_lines pl
  GROUP BY pl.odoo_product_id, pl.product_ref, pl.product_name, pl.supplier_id, pl.supplier_name, pl.month
)
SELECT
  sa.odoo_product_id, sa.product_ref, sa.product_name,
  sa.supplier_id, sa.supplier_name, sa.month,
  sa.supplier_avg_price::numeric(20,4),
  b.product_avg_price_month::numeric(20,4) AS benchmark_price,
  b.suppliers_in_month,
  ROUND((sa.supplier_avg_price / NULLIF(b.product_avg_price_month,0) * 100)::numeric, 1) AS price_index,
  (sa.supplier_avg_price - b.product_avg_price_month)::numeric(20,4) AS price_delta,
  CASE WHEN sa.supplier_avg_price > b.product_avg_price_month
       THEN ((sa.supplier_avg_price - b.product_avg_price_month) * sa.supplier_qty)::numeric(20,2)
       ELSE 0::numeric(20,2) END AS overpaid_mxn,
  CASE WHEN sa.supplier_avg_price < b.product_avg_price_month
       THEN ((b.product_avg_price_month - sa.supplier_avg_price) * sa.supplier_qty)::numeric(20,2)
       ELSE 0::numeric(20,2) END AS saved_mxn,
  sa.supplier_qty, sa.supplier_spend::numeric(20,2), sa.supplier_lines,
  sa.last_po_date, sa.last_po_name,
  CASE
    WHEN b.suppliers_in_month < 2 THEN 'single_source'
    WHEN sa.supplier_avg_price > b.product_avg_price_month * 1.30 THEN 'overpriced'
    WHEN sa.supplier_avg_price > b.product_avg_price_month * 1.10 THEN 'above_market'
    WHEN sa.supplier_avg_price < b.product_avg_price_month * 0.90 THEN 'below_market'
    ELSE 'aligned'
  END AS price_flag,
  NOW() AS computed_at
FROM supplier_agg sa
JOIN benchmarks b ON b.odoo_product_id = sa.odoo_product_id AND b.month = sa.month;

CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_price_index_pk
  ON public.supplier_price_index (odoo_product_id, supplier_id, month);
CREATE INDEX IF NOT EXISTS idx_supplier_price_index_flag
  ON public.supplier_price_index (price_flag, overpaid_mxn DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_price_index_supplier
  ON public.supplier_price_index (supplier_id, month DESC);

COMMENT ON MATERIALIZED VIEW public.supplier_price_index IS
'Índice de precio por (producto, proveedor, mes) normalizado vs benchmark del mercado.';

CREATE OR REPLACE FUNCTION public.refresh_supplier_price_index()
RETURNS void LANGUAGE sql AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.supplier_price_index;
$$;
