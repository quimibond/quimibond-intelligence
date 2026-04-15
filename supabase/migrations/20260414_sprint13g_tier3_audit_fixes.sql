-- Sprint 13g: Tier-3 audit cleanup (5 matviews/views)
--
-- Applies the same BOM-cost-preferred + MXN-canonical patterns as sprint 13f
-- to the remaining 5 models flagged during the audit:
--
--   1. inventory_velocity: stock_value now uses effective_cost (BOM first)
--      + exposes effective_cost column so downstream views inherit cleanly.
--   2. real_sale_price: avg_price is now weighted over subtotal_mxn (no more
--      MXN+USD mixing); markup compares against effective_cost.
--   3. dead_stock_analysis: inventory_value uses effective_cost.
--   4. customer_ltv_health: CRITICAL fix — ltv_revenue/revenue_12m/revenue_3m
--      now use price_subtotal_mxn. Previous version averaged MXN + USD
--      amounts as if equal, producing wrong LTV tiers for bi-currency
--      customers.
--   5. stockout_queue: inherits fixed iv.effective_cost + rsp.price_current.

DROP VIEW IF EXISTS stockout_queue;
DROP MATERIALIZED VIEW IF EXISTS inventory_velocity CASCADE;
DROP MATERIALIZED VIEW IF EXISTS real_sale_price CASCADE;
DROP MATERIALIZED VIEW IF EXISTS dead_stock_analysis CASCADE;
DROP MATERIALIZED VIEW IF EXISTS customer_ltv_health CASCADE;

-- ─── (1) inventory_velocity ──────────────────────────────────────────
CREATE MATERIALIZED VIEW inventory_velocity AS
WITH sales_velocity AS (
  SELECT
    il.odoo_product_id,
    SUM(CASE WHEN il.invoice_date >= CURRENT_DATE - 90  THEN il.quantity ELSE 0 END) AS qty_sold_90d,
    SUM(CASE WHEN il.invoice_date >= CURRENT_DATE - 180 THEN il.quantity ELSE 0 END) AS qty_sold_180d,
    SUM(CASE WHEN il.invoice_date >= CURRENT_DATE - 365 THEN il.quantity ELSE 0 END) AS qty_sold_365d,
    COUNT(DISTINCT CASE WHEN il.invoice_date >= CURRENT_DATE - 365 THEN il.company_id END) AS customers_12m,
    MAX(il.invoice_date) AS last_sale_date
  FROM odoo_invoice_lines il
  WHERE il.move_type = 'out_invoice'
    AND il.odoo_product_id IS NOT NULL
    AND il.quantity > 0
  GROUP BY il.odoo_product_id
)
SELECT
  p.odoo_product_id,
  p.name AS product_name,
  p.internal_ref AS product_ref,
  p.category,
  p.stock_qty,
  p.reserved_qty,
  p.available_qty,
  p.reorder_min,
  p.reorder_max,
  p.standard_price,
  p.avg_cost,
  COALESCE(prc.real_unit_cost, p.avg_cost, p.standard_price, 0) AS effective_cost,
  CASE
    WHEN prc.real_unit_cost IS NOT NULL THEN 'bom'
    WHEN COALESCE(p.avg_cost, 0) > 0 THEN 'avg_cost'
    WHEN COALESCE(p.standard_price, 0) > 0 THEN 'standard'
    ELSE 'none'
  END AS cost_source,
  COALESCE(sv.qty_sold_90d, 0) AS qty_sold_90d,
  COALESCE(sv.qty_sold_180d, 0) AS qty_sold_180d,
  COALESCE(sv.qty_sold_365d, 0) AS qty_sold_365d,
  COALESCE(sv.customers_12m, 0) AS customers_12m,
  sv.last_sale_date,
  ROUND(COALESCE(sv.qty_sold_90d, 0) / 90.0, 4) AS daily_run_rate,
  CASE
    WHEN COALESCE(sv.qty_sold_90d, 0) > 0
    THEN ROUND(p.available_qty / (sv.qty_sold_90d / 90.0), 0)
    ELSE NULL
  END AS days_of_stock,
  ROUND(p.stock_qty * COALESCE(prc.real_unit_cost, p.avg_cost, p.standard_price, 0), 0) AS stock_value,
  CASE
    WHEN p.stock_qty > 0 AND COALESCE(sv.qty_sold_90d, 0) > 0
    THEN ROUND(sv.qty_sold_90d * 4.0 / p.stock_qty, 2)
    ELSE 0
  END AS annual_turnover,
  CASE
    WHEN p.available_qty <= 0 AND COALESCE(sv.qty_sold_90d, 0) > 0 THEN 'stockout'
    WHEN p.reorder_min > 0 AND p.available_qty <= p.reorder_min THEN 'below_min'
    WHEN COALESCE(sv.qty_sold_90d, 0) > 0 AND (p.available_qty / (sv.qty_sold_90d / 90.0)) < 14 THEN 'urgent_14d'
    WHEN COALESCE(sv.qty_sold_90d, 0) > 0 AND (p.available_qty / (sv.qty_sold_90d / 90.0)) < 30 THEN 'reorder_30d'
    WHEN COALESCE(sv.qty_sold_90d, 0) = 0 AND p.stock_qty > 0 THEN 'no_movement'
    ELSE 'adequate'
  END AS reorder_status,
  CASE
    WHEN COALESCE(sv.qty_sold_365d, 0) = 0 THEN 'D_dead'
    ELSE NULL
  END AS abc_placeholder
FROM odoo_products p
LEFT JOIN sales_velocity sv ON sv.odoo_product_id = p.odoo_product_id
LEFT JOIN product_real_cost prc ON prc.odoo_product_id = p.odoo_product_id
WHERE p.active = true
  AND p.product_type IN ('product', 'consu')
ORDER BY COALESCE(sv.qty_sold_365d, 0) DESC;

CREATE INDEX idx_iv_product_id ON inventory_velocity(odoo_product_id);
CREATE INDEX idx_iv_reorder_status ON inventory_velocity(reorder_status);

COMMENT ON MATERIALIZED VIEW inventory_velocity IS
  'Sprint 13g: effective_cost column added (BOM real cost preferred). stock_value now reflects material cost truth.';

-- ─── (2) real_sale_price ─────────────────────────────────────────────
CREATE MATERIALIZED VIEW real_sale_price AS
WITH sale_lines AS (
  SELECT
    ol.odoo_product_id,
    ol.product_ref,
    ol.product_name,
    ol.price_unit,
    ol.qty,
    COALESCE(ol.subtotal_mxn, ol.subtotal) AS subtotal_mxn,
    ol.order_date,
    ol.company_id
  FROM odoo_order_lines ol
  WHERE ol.order_type = 'sale'
    AND ol.price_unit > 0
    AND ol.qty > 0
    AND ol.odoo_product_id IS NOT NULL
    AND ol.order_date >= CURRENT_DATE - INTERVAL '18 months'
),
agg AS (
  SELECT
    odoo_product_id,
    MAX(product_ref) AS product_ref,
    MAX(product_name) AS product_name,
    SUM(subtotal_mxn) FILTER (WHERE order_date >= CURRENT_DATE - INTERVAL '90 days')
      / NULLIF(SUM(qty) FILTER (WHERE order_date >= CURRENT_DATE - INTERVAL '90 days'), 0) AS price_90d,
    SUM(subtotal_mxn) FILTER (WHERE order_date >= CURRENT_DATE - INTERVAL '180 days')
      / NULLIF(SUM(qty) FILTER (WHERE order_date >= CURRENT_DATE - INTERVAL '180 days'), 0) AS price_180d,
    SUM(subtotal_mxn) FILTER (WHERE order_date >= CURRENT_DATE - INTERVAL '365 days')
      / NULLIF(SUM(qty) FILTER (WHERE order_date >= CURRENT_DATE - INTERVAL '365 days'), 0) AS price_12m,
    MIN(subtotal_mxn / NULLIF(qty, 0)) FILTER (WHERE order_date >= CURRENT_DATE - INTERVAL '365 days') AS min_price_12m,
    MAX(subtotal_mxn / NULLIF(qty, 0)) FILTER (WHERE order_date >= CURRENT_DATE - INTERVAL '365 days') AS max_price_12m,
    STDDEV(subtotal_mxn / NULLIF(qty, 0)) FILTER (WHERE order_date >= CURRENT_DATE - INTERVAL '365 days') AS stddev_12m,
    SUM(qty) FILTER (WHERE order_date >= CURRENT_DATE - INTERVAL '90 days') AS qty_sold_90d,
    SUM(qty) FILTER (WHERE order_date >= CURRENT_DATE - INTERVAL '365 days') AS qty_sold_12m,
    SUM(subtotal_mxn) FILTER (WHERE order_date >= CURRENT_DATE - INTERVAL '365 days') AS revenue_12m,
    COUNT(DISTINCT company_id) FILTER (WHERE order_date >= CURRENT_DATE - INTERVAL '365 days') AS customers_12m,
    COUNT(*) AS sale_lines_12m,
    MAX(order_date) AS last_sale_date
  FROM sale_lines
  GROUP BY odoo_product_id
)
SELECT
  a.odoo_product_id,
  a.product_ref,
  a.product_name,
  COALESCE(a.price_90d, a.price_180d, a.price_12m) AS price_current,
  a.price_90d,
  a.price_180d,
  a.price_12m,
  a.min_price_12m,
  a.max_price_12m,
  a.stddev_12m,
  CASE
    WHEN a.price_12m > 0 THEN ROUND(a.stddev_12m / a.price_12m, 3)
    ELSE NULL
  END AS cv_12m,
  a.qty_sold_90d,
  a.qty_sold_12m,
  a.revenue_12m,
  a.customers_12m,
  a.sale_lines_12m,
  a.last_sale_date,
  COALESCE(prc.real_unit_cost, p.standard_price) AS odoo_cost,
  CASE
    WHEN prc.real_unit_cost IS NOT NULL THEN 'bom'
    WHEN COALESCE(p.standard_price, 0) > 0 THEN 'standard'
    ELSE 'none'
  END AS cost_source,
  CASE
    WHEN COALESCE(prc.real_unit_cost, p.standard_price) > 0
         AND COALESCE(a.price_90d, a.price_12m) > 0
    THEN ROUND(
      (COALESCE(a.price_90d, a.price_12m) - COALESCE(prc.real_unit_cost, p.standard_price))
      / COALESCE(prc.real_unit_cost, p.standard_price) * 100, 1
    )
    ELSE NULL
  END AS markup_vs_cost_pct,
  CASE
    WHEN p.list_price > 0
         AND COALESCE(a.price_90d, a.price_12m) > 0
         AND (abs(p.list_price - COALESCE(a.price_90d, a.price_12m)) / COALESCE(a.price_90d, a.price_12m)) > 0.30
    THEN true
    ELSE false
  END AS list_price_is_stale,
  NOW() AS computed_at
FROM agg a
LEFT JOIN odoo_products p ON p.odoo_product_id = a.odoo_product_id
LEFT JOIN product_real_cost prc ON prc.odoo_product_id = a.odoo_product_id;

CREATE INDEX idx_rsp_product_id ON real_sale_price(odoo_product_id);

COMMENT ON MATERIALIZED VIEW real_sale_price IS
  'Sprint 13g: weighted avg price is now SUM(subtotal_mxn)/SUM(qty) (currency-safe). markup_vs_cost_pct compares against effective BOM cost.';

-- ─── (3) dead_stock_analysis ─────────────────────────────────────────
CREATE MATERIALIZED VIEW dead_stock_analysis AS
SELECT
  p.odoo_product_id,
  COALESCE(p.internal_ref, p.name) AS product_ref,
  p.name AS product_name,
  p.category,
  p.stock_qty,
  p.standard_price,
  COALESCE(prc.real_unit_cost, p.standard_price) AS effective_cost,
  CASE
    WHEN prc.real_unit_cost IS NOT NULL THEN 'bom'
    WHEN COALESCE(p.standard_price, 0) > 0 THEN 'standard'
    ELSE 'none'
  END AS cost_source,
  ROUND(p.stock_qty * COALESCE(prc.real_unit_cost, p.standard_price), 0) AS inventory_value,
  p.list_price,
  MAX(ol.order_date) AS last_sale_date,
  CURRENT_DATE - MAX(ol.order_date) AS days_since_last_sale,
  COUNT(DISTINCT ol.company_id) AS historical_customers,
  COALESCE(SUM(COALESCE(ol.subtotal_mxn, ol.subtotal)), 0) AS lifetime_revenue
FROM odoo_products p
LEFT JOIN odoo_order_lines ol
  ON ol.odoo_product_id = p.odoo_product_id AND ol.order_type = 'sale'
LEFT JOIN product_real_cost prc ON prc.odoo_product_id = p.odoo_product_id
WHERE p.stock_qty > 0 AND p.active = true
GROUP BY p.odoo_product_id, p.name, p.internal_ref, p.category, p.stock_qty,
         p.standard_price, prc.real_unit_cost, p.list_price
HAVING MAX(ol.order_date) IS NULL OR MAX(ol.order_date) < (CURRENT_DATE - 60);

CREATE INDEX idx_dsa_product_id ON dead_stock_analysis(odoo_product_id);

COMMENT ON MATERIALIZED VIEW dead_stock_analysis IS
  'Sprint 13g: inventory_value uses effective_cost (BOM real preferred).';

-- ─── (4) customer_ltv_health (CRITICAL fix) ──────────────────────────
CREATE MATERIALIZED VIEW customer_ltv_health AS
WITH sales_hist AS (
  SELECT
    il.company_id,
    COUNT(DISTINCT il.move_name) AS total_invoices,
    MIN(il.invoice_date) AS first_purchase,
    MAX(il.invoice_date) AS last_purchase,
    SUM(COALESCE(il.price_subtotal_mxn, il.price_subtotal)) AS ltv_revenue,
    SUM(CASE
      WHEN il.invoice_date >= CURRENT_DATE - INTERVAL '1 year'
      THEN COALESCE(il.price_subtotal_mxn, il.price_subtotal)
      ELSE 0
    END) AS revenue_12m,
    SUM(CASE
      WHEN il.invoice_date >= CURRENT_DATE - INTERVAL '3 months'
      THEN COALESCE(il.price_subtotal_mxn, il.price_subtotal)
      ELSE 0
    END) AS revenue_3m,
    SUM(CASE
      WHEN il.invoice_date >= CURRENT_DATE - INTERVAL '1 year'
       AND il.invoice_date <  CURRENT_DATE - INTERVAL '3 months'
      THEN COALESCE(il.price_subtotal_mxn, il.price_subtotal)
      ELSE 0
    END) AS revenue_3m_to_12m
  FROM odoo_invoice_lines il
  WHERE il.move_type = 'out_invoice'
    AND il.company_id IS NOT NULL
    AND il.invoice_date IS NOT NULL
    AND il.quantity > 0
  GROUP BY il.company_id
),
overdue AS (
  SELECT
    company_id,
    SUM(COALESCE(amount_residual_mxn, amount_residual)) AS overdue_amount,
    MAX(days_overdue) AS max_days_overdue,
    COUNT(*) AS overdue_count
  FROM odoo_invoices
  WHERE move_type = 'out_invoice'
    AND state = 'posted'
    AND payment_state IN ('not_paid', 'partial')
    AND days_overdue > 0
    AND company_id IS NOT NULL
  GROUP BY company_id
)
SELECT
  c.id AS company_id,
  c.canonical_name AS company_name,
  cp.tier,
  COALESCE(sh.total_invoices, 0) AS total_invoices,
  sh.first_purchase,
  sh.last_purchase,
  COALESCE(sh.ltv_revenue, 0) AS ltv_mxn,
  COALESCE(sh.revenue_12m, 0) AS revenue_12m,
  COALESCE(sh.revenue_3m, 0) AS revenue_3m,
  CASE
    WHEN sh.revenue_3m_to_12m > 0
    THEN ROUND((COALESCE(sh.revenue_3m, 0) / (sh.revenue_3m_to_12m / 3.0) - 1) * 100, 1)
    ELSE NULL
  END AS trend_pct_vs_prior_quarters,
  COALESCE(o.overdue_amount, 0) AS overdue_mxn,
  COALESCE(o.max_days_overdue, 0) AS max_days_overdue,
  COALESCE(o.overdue_count, 0) AS overdue_invoices,
  LEAST(100, GREATEST(0,
    CASE
      WHEN sh.last_purchase IS NULL THEN 100
      ELSE LEAST(80, CURRENT_DATE - sh.last_purchase)
    END
    + CASE
      WHEN COALESCE(o.max_days_overdue, 0) >= 60 THEN 20
      WHEN COALESCE(o.max_days_overdue, 0) >= 30 THEN 10
      ELSE 0
    END
  )) AS churn_risk_score,
  LEAST(100, GREATEST(0,
    LEAST(60, COALESCE(o.max_days_overdue, 0))
    + CASE
      WHEN COALESCE(o.overdue_amount, 0) > 500000 THEN 40
      WHEN COALESCE(o.overdue_amount, 0) > 100000 THEN 20
      WHEN COALESCE(o.overdue_amount, 0) >      0 THEN 10
      ELSE 0
    END
  )) AS overdue_risk_score,
  CURRENT_DATE::timestamp - COALESCE(sh.last_purchase::timestamp, CURRENT_DATE - INTERVAL '1000 days') AS days_since_last_order,
  NOW() AS computed_at
FROM companies c
LEFT JOIN company_profile cp ON cp.company_id = c.id
LEFT JOIN sales_hist sh ON sh.company_id = c.id
LEFT JOIN overdue o ON o.company_id = c.id
WHERE c.is_customer = true;

CREATE INDEX idx_cltv_company_id ON customer_ltv_health(company_id);

COMMENT ON MATERIALIZED VIEW customer_ltv_health IS
  'Sprint 13g CRITICAL fix: LTV / revenue_12m / revenue_3m now use price_subtotal_mxn. Previous version summed MXN + USD as if equal, producing wrong tiers.';

-- ─── (5) stockout_queue (regular view) ───────────────────────────────
CREATE VIEW stockout_queue AS
WITH open_pos AS (
  SELECT
    ol.odoo_product_id,
    SUM(ol.qty - COALESCE(ol.qty_delivered, 0)) AS qty_on_order
  FROM odoo_order_lines ol
  JOIN odoo_purchase_orders po ON po.odoo_order_id = ol.odoo_order_id
  WHERE ol.order_type = 'purchase'
    AND po.state IN ('draft', 'sent', 'to approve', 'purchase')
    AND ol.qty > COALESCE(ol.qty_delivered, 0)
  GROUP BY ol.odoo_product_id
),
last_supplier AS (
  SELECT DISTINCT ON (ol.odoo_product_id)
    ol.odoo_product_id,
    c.id AS last_supplier_id,
    c.name AS last_supplier_name,
    ol.price_unit AS last_purchase_price,
    ol.order_date AS last_purchase_date
  FROM odoo_order_lines ol
  JOIN companies c ON c.id = ol.company_id
  WHERE ol.order_type = 'purchase' AND ol.price_unit > 0
  ORDER BY ol.odoo_product_id, ol.order_date DESC
)
SELECT
  iv.odoo_product_id,
  iv.product_ref,
  iv.product_name,
  iv.category,
  iv.stock_qty,
  iv.reserved_qty,
  iv.available_qty,
  iv.daily_run_rate,
  iv.qty_sold_90d,
  iv.days_of_stock,
  (iv.daily_run_rate * 30 * COALESCE(rsp.price_current, iv.effective_cost))::numeric(20,2) AS revenue_at_risk_30d_mxn,
  (GREATEST(iv.reorder_min - iv.stock_qty, 0) * iv.effective_cost)::numeric(20,2) AS replenish_cost_mxn,
  GREATEST(
    COALESCE(iv.reorder_max, iv.reorder_min * 2, iv.daily_run_rate * 60)
    - iv.stock_qty - COALESCE(po.qty_on_order, 0), 0
  ) AS suggested_order_qty,
  COALESCE(po.qty_on_order, 0) AS qty_on_order,
  (
    SELECT cpm.company_name
    FROM customer_product_matrix cpm
    WHERE cpm.odoo_product_id = iv.odoo_product_id
    ORDER BY cpm.revenue DESC
    LIMIT 1
  ) AS top_consumer,
  ls.last_supplier_id,
  ls.last_supplier_name,
  ls.last_purchase_price,
  ls.last_purchase_date,
  CASE
    WHEN iv.days_of_stock IS NULL OR iv.days_of_stock <= 0 THEN 'STOCKOUT'
    WHEN iv.days_of_stock < 7  THEN 'CRITICAL'
    WHEN iv.days_of_stock < 15 THEN 'URGENT'
    WHEN iv.days_of_stock < 30 THEN 'ATTENTION'
    ELSE 'OK'
  END AS urgency,
  (
    LEAST(100, iv.daily_run_rate * 2)
    + GREATEST(0, 30 - COALESCE(iv.days_of_stock, 0))
    - LEAST(30, COALESCE(po.qty_on_order, 0) / NULLIF(iv.daily_run_rate, 0))
  )::integer AS priority_score
FROM inventory_velocity iv
LEFT JOIN open_pos po ON po.odoo_product_id = iv.odoo_product_id
LEFT JOIN last_supplier ls ON ls.odoo_product_id = iv.odoo_product_id
LEFT JOIN real_sale_price rsp ON rsp.odoo_product_id = iv.odoo_product_id
WHERE iv.qty_sold_90d > 0 AND (iv.days_of_stock IS NULL OR iv.days_of_stock < 30);

COMMENT ON VIEW stockout_queue IS
  'Sprint 13g: inherits fixed iv.effective_cost + rsp.price_current (MXN-weighted).';
