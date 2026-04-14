-- Sprint 13f: audit-driven cleanup of related matviews/views
--
-- Following the PMA audit, fixes the analogous bugs in 5 sibling models:
--
-- (1) DROP margin_analysis view: same row-explosion + currency-mixing
--     bugs as old PMA, no callers in the frontend. Just delete it.
--
-- (2) customer_margin_analysis: replace COALESCE(avg_cost, standard_price)
--     with BOM real cost when available. unchanged: aggregates per company
--     line by line (no row explosion).
--
-- (3) invoice_line_margins: same (BOM real cost over cached). Below-cost
--     alerts will reflect the true cost.
--
-- (4) working_capital_cycle: inventory_value now uses BOM real cost when
--     available so DIO/CCC reflect physical material cost not stale price.
--
-- (5) purchase_price_intelligence: total_spent now uses subtotal_mxn so
--     cross-product roll-ups don't mix MXN+USD as if equal.

-- ─── (1) drop margin_analysis ────────────────────────────────────────
DROP VIEW IF EXISTS margin_analysis;

-- ─── (2) customer_margin_analysis with BOM real cost ─────────────────
DROP MATERIALIZED VIEW IF EXISTS customer_margin_analysis CASCADE;

CREATE MATERIALIZED VIEW customer_margin_analysis AS
WITH line_margin AS (
  SELECT
    il.odoo_partner_id,
    il.company_id,
    co.canonical_name AS company_name,
    il.odoo_product_id,
    il.product_name,
    il.product_ref,
    il.invoice_date,
    date_trunc('month', il.invoice_date::timestamptz)::date AS month,
    il.quantity,
    il.price_unit AS sale_price,
    COALESCE(il.price_subtotal_mxn, il.price_subtotal) AS line_revenue,
    -- Sprint 13f: prefer BOM real cost, fall back to avg_cost, then standard_price
    COALESCE(prc.real_unit_cost, p.avg_cost, p.standard_price, 0) AS unit_cost,
    il.quantity
      * COALESCE(prc.real_unit_cost, p.avg_cost, p.standard_price, 0) AS line_cost,
    COALESCE(il.price_subtotal_mxn, il.price_subtotal)
      - il.quantity
        * COALESCE(prc.real_unit_cost, p.avg_cost, p.standard_price, 0) AS line_margin,
    -- track which cost source was used per line
    CASE
      WHEN prc.real_unit_cost IS NOT NULL THEN 'bom'
      WHEN COALESCE(p.avg_cost, 0) > 0 THEN 'avg_cost'
      WHEN COALESCE(p.standard_price, 0) > 0 THEN 'standard'
      ELSE 'none'
    END AS cost_source
  FROM odoo_invoice_lines il
  LEFT JOIN companies co ON co.id = il.company_id
  LEFT JOIN odoo_products p ON p.odoo_product_id = il.odoo_product_id
  LEFT JOIN product_real_cost prc ON prc.odoo_product_id = il.odoo_product_id
  WHERE il.move_type = 'out_invoice'
    AND il.company_id IS NOT NULL
    AND il.invoice_date IS NOT NULL
    AND il.quantity > 0
)
SELECT
  company_id,
  company_name,
  COUNT(DISTINCT odoo_product_id) AS distinct_products,
  COUNT(*) AS total_lines,
  ROUND(SUM(line_revenue), 0) AS total_revenue,
  ROUND(SUM(line_cost), 0) AS total_cost,
  ROUND(SUM(line_margin), 0) AS total_margin,
  CASE
    WHEN SUM(line_revenue) > 0
    THEN ROUND(SUM(line_margin) / SUM(line_revenue) * 100, 1)
    ELSE 0
  END AS margin_pct,
  ROUND(SUM(CASE WHEN invoice_date >= CURRENT_DATE - 365 THEN line_revenue ELSE 0 END), 0) AS revenue_12m,
  ROUND(SUM(CASE WHEN invoice_date >= CURRENT_DATE - 365 THEN line_margin  ELSE 0 END), 0) AS margin_12m,
  CASE
    WHEN SUM(CASE WHEN invoice_date >= CURRENT_DATE - 365 THEN line_revenue ELSE 0 END) > 0
    THEN ROUND(
      SUM(CASE WHEN invoice_date >= CURRENT_DATE - 365 THEN line_margin  ELSE 0 END)
      / SUM(CASE WHEN invoice_date >= CURRENT_DATE - 365 THEN line_revenue ELSE 0 END) * 100, 1
    )
    ELSE 0
  END AS margin_pct_12m,
  -- Sprint 13f: surface cost-data quality at customer level
  COUNT(*) FILTER (WHERE cost_source = 'bom') AS lines_with_bom_cost,
  COUNT(*) FILTER (WHERE cost_source = 'standard') AS lines_with_standard_cost,
  COUNT(*) FILTER (WHERE cost_source = 'none') AS lines_without_cost,
  MIN(invoice_date) AS first_sale,
  MAX(invoice_date) AS last_sale
FROM line_margin
GROUP BY company_id, company_name
ORDER BY SUM(line_margin) DESC;

CREATE INDEX idx_cma_company ON customer_margin_analysis(company_id);

COMMENT ON MATERIALIZED VIEW customer_margin_analysis IS
  'Sprint 13f: per-customer margin from invoice lines. unit_cost now prefers BOM real cost (recursive material rolldown) over cached avg_cost/standard_price. cost_source counts surface data quality per customer.';

-- ─── (3) invoice_line_margins with BOM real cost ─────────────────────
DROP VIEW IF EXISTS invoice_line_margins;

CREATE VIEW invoice_line_margins AS
WITH base AS (
  SELECT
    il.id,
    il.move_name,
    il.invoice_date,
    il.odoo_partner_id,
    il.company_id,
    il.product_ref,
    il.product_name,
    il.quantity,
    il.price_unit,
    il.discount,
    COALESCE(il.price_subtotal_mxn, il.price_subtotal) AS price_subtotal,
    p.standard_price,
    p.avg_cost,
    prc.real_unit_cost AS bom_real_cost,
    -- Sprint 13f: prefer BOM real cost
    COALESCE(prc.real_unit_cost, NULLIF(p.avg_cost, 0), p.standard_price) AS unit_cost,
    CASE
      WHEN prc.real_unit_cost IS NOT NULL THEN 'bom'
      WHEN COALESCE(p.avg_cost, 0) > 0 THEN 'avg_cost'
      WHEN COALESCE(p.standard_price, 0) > 0 THEN 'standard'
      ELSE 'none'
    END AS cost_source
  FROM odoo_invoice_lines il
  LEFT JOIN odoo_products p ON p.odoo_product_id = il.odoo_product_id
  LEFT JOIN product_real_cost prc ON prc.odoo_product_id = il.odoo_product_id
  WHERE il.move_type = 'out_invoice'
    AND il.invoice_date IS NOT NULL
    AND il.invoice_date >= CURRENT_DATE - INTERVAL '90 days'
    AND il.quantity > 0
    AND il.price_unit > 0
),
computed AS (
  SELECT
    b.*,
    b.price_unit - b.unit_cost AS margin_per_unit,
    CASE
      WHEN b.unit_cost IS NULL OR b.unit_cost = 0 THEN NULL
      ELSE ROUND((b.price_unit - b.unit_cost) / b.price_unit * 100, 1)
    END AS gross_margin_pct,
    b.price_unit < b.unit_cost AS below_cost,
    b.quantity * (b.price_unit - b.unit_cost) AS margin_total
  FROM base b
)
SELECT
  c.id,
  c.move_name,
  c.invoice_date,
  c.odoo_partner_id,
  co.name AS company_name,
  c.product_ref,
  c.product_name,
  c.quantity,
  c.price_unit,
  c.discount,
  c.unit_cost,
  c.cost_source,
  c.gross_margin_pct,
  c.below_cost,
  c.margin_total,
  c.price_subtotal
FROM computed c
LEFT JOIN companies co ON co.id = c.company_id
WHERE c.gross_margin_pct IS NOT NULL
  AND c.gross_margin_pct > -100
  AND (c.gross_margin_pct < 15 OR c.below_cost = true OR c.discount > 20)
ORDER BY c.below_cost DESC, c.gross_margin_pct;

COMMENT ON VIEW invoice_line_margins IS
  'Sprint 13f: per-invoice-line margin with BOM real cost preferred. Below-cost alerts are now grounded in real material cost; cost_source flags provenance.';

-- ─── (4) working_capital_cycle with BOM-derived inventory value ──────
DROP VIEW IF EXISTS working_capital_cycle;

CREATE VIEW working_capital_cycle AS
WITH revenue_12m AS (
  SELECT SUM(amount_total_mxn) AS revenue
  FROM odoo_invoices
  WHERE move_type = 'out_invoice'
    AND state = 'posted'
    AND invoice_date >= CURRENT_DATE - INTERVAL '365 days'
),
cogs_12m AS (
  SELECT ABS(SUM(ab.balance)) AS cogs
  FROM odoo_account_balances ab
  JOIN odoo_chart_of_accounts coa ON coa.odoo_account_id = ab.odoo_account_id
  WHERE coa.account_type = 'expense_direct_cost'
    AND ab.period ~ '^20[12][0-9]-[01][0-9]$'
    AND ab.period >= to_char(CURRENT_DATE - INTERVAL '1 year', 'YYYY-MM')
),
ar AS (
  SELECT SUM(COALESCE(amount_residual_mxn, amount_residual)) AS ar
  FROM odoo_invoices
  WHERE move_type = 'out_invoice' AND state = 'posted'
    AND payment_state IN ('not_paid','partial')
    AND amount_residual > 0
),
ap AS (
  SELECT SUM(COALESCE(amount_residual_mxn, amount_residual)) AS ap
  FROM odoo_invoices
  WHERE move_type = 'in_invoice' AND state = 'posted'
    AND payment_state IN ('not_paid','partial')
    AND amount_residual > 0
),
-- Sprint 13f: inventory now uses BOM real cost when available
inventory AS (
  SELECT
    SUM(p.stock_qty * COALESCE(prc.real_unit_cost, p.standard_price)) AS inventory_value,
    SUM(CASE WHEN prc.real_unit_cost IS NOT NULL THEN p.stock_qty * prc.real_unit_cost ELSE 0 END) AS inv_value_from_bom,
    SUM(CASE WHEN prc.real_unit_cost IS NULL THEN p.stock_qty * p.standard_price ELSE 0 END) AS inv_value_from_standard
  FROM odoo_products p
  LEFT JOIN product_real_cost prc ON prc.odoo_product_id = p.odoo_product_id
  WHERE p.active = true
    AND p.stock_qty > 0
    AND COALESCE(prc.real_unit_cost, p.standard_price) > 0
)
SELECT
  ROUND(r.revenue, 0) AS revenue_12m_mxn,
  ROUND(c.cogs, 0) AS cogs_12m_mxn,
  ROUND(r.revenue - c.cogs, 0) AS gross_profit_12m_mxn,
  ROUND((r.revenue - c.cogs) / NULLIF(r.revenue, 0) * 100, 1) AS gross_margin_pct,
  ROUND(ar.ar, 0) AS ar_mxn,
  ROUND(ap.ap, 0) AS ap_mxn,
  ROUND(i.inventory_value, 0) AS inventory_mxn,
  ROUND(i.inv_value_from_bom, 0) AS inventory_from_bom_mxn,
  ROUND(i.inv_value_from_standard, 0) AS inventory_from_standard_mxn,
  ROUND(ar.ar / NULLIF(r.revenue / 365, 0), 1) AS dso_days,
  ROUND(ap.ap / NULLIF(c.cogs / 365, 0), 1) AS dpo_days,
  ROUND(i.inventory_value / NULLIF(c.cogs / 365, 0), 1) AS dio_days,
  ROUND(
    ar.ar / NULLIF(r.revenue / 365, 0)
    + i.inventory_value / NULLIF(c.cogs / 365, 0)
    - ap.ap / NULLIF(c.cogs / 365, 0), 1
  ) AS ccc_days,
  ROUND(ar.ar + i.inventory_value - ap.ap, 0) AS working_capital_mxn,
  NOW() AS computed_at
FROM revenue_12m r, cogs_12m c, ar, ap, inventory i;

COMMENT ON VIEW working_capital_cycle IS
  'Sprint 13f: inventory_value uses BOM real cost when available, falls back to standard_price. New columns inv_value_from_bom/inv_value_from_standard surface the split.';

-- ─── (5) purchase_price_intelligence with subtotal_mxn ───────────────
DROP MATERIALIZED VIEW IF EXISTS purchase_price_intelligence CASCADE;

CREATE MATERIALIZED VIEW purchase_price_intelligence AS
WITH purchase_history AS (
  SELECT
    ol.product_ref, ol.product_name, ol.odoo_product_id,
    ol.company_id AS supplier_id,
    co.canonical_name AS supplier_name,
    ol.price_unit, ol.qty,
    -- Sprint 13f: use MXN-converted subtotal so cross-product totals are valid
    COALESCE(ol.subtotal_mxn, ol.subtotal) AS subtotal_mxn,
    ol.subtotal AS subtotal_native,
    ol.currency, ol.order_date, ol.order_name
  FROM odoo_order_lines ol
  LEFT JOIN companies co ON co.id = ol.company_id
  WHERE ol.order_type = 'purchase'
    AND ol.company_id IS NOT NULL
    AND ol.price_unit > 0
    AND ol.qty > 0
    AND ol.order_state IN ('purchase', 'done')
),
product_stats AS (
  SELECT
    product_ref, product_name, odoo_product_id, currency,
    COUNT(*) AS total_purchases,
    COUNT(DISTINCT supplier_id) AS supplier_count,
    ROUND(AVG(price_unit), 2) AS avg_price,
    ROUND(MIN(price_unit), 2) AS min_price,
    ROUND(MAX(price_unit), 2) AS max_price,
    ROUND(STDDEV_POP(price_unit), 2) AS price_stddev,
    ROUND(AVG(qty), 2) AS avg_qty,
    ROUND(MIN(qty), 2) AS min_qty,
    ROUND(MAX(qty), 2) AS max_qty,
    ROUND(SUM(subtotal_mxn), 2) AS total_spent_mxn,
    ROUND(SUM(subtotal_native), 2) AS total_spent_native,
    MAX(order_date) AS last_purchase_date,
    MIN(order_date) AS first_purchase_date
  FROM purchase_history
  WHERE product_ref IS NOT NULL AND product_ref <> ''
  GROUP BY odoo_product_id, product_ref, product_name, currency
  HAVING COUNT(*) >= 2
),
latest_purchases AS (
  SELECT DISTINCT ON (odoo_product_id, currency)
    odoo_product_id, product_ref, currency,
    price_unit AS last_price,
    qty AS last_qty,
    supplier_name AS last_supplier,
    order_date AS last_order_date,
    order_name AS last_order_name
  FROM purchase_history
  WHERE product_ref IS NOT NULL AND product_ref <> ''
  ORDER BY odoo_product_id, currency, order_date DESC
),
previous_purchases AS (
  SELECT DISTINCT ON (sub.odoo_product_id, sub.currency)
    sub.odoo_product_id, sub.currency,
    sub.price_unit AS prev_price,
    sub.order_date AS prev_order_date
  FROM (
    SELECT
      ph.*,
      ROW_NUMBER() OVER (PARTITION BY odoo_product_id, currency ORDER BY order_date DESC) AS rn
    FROM purchase_history ph
    WHERE ph.product_ref IS NOT NULL AND ph.product_ref <> ''
  ) sub
  WHERE sub.rn = 2
  ORDER BY sub.odoo_product_id, sub.currency, sub.order_date DESC
)
SELECT
  ps.product_ref, ps.product_name, ps.odoo_product_id, ps.currency,
  ps.total_purchases, ps.supplier_count,
  ps.avg_price, ps.min_price, ps.max_price, ps.price_stddev,
  ps.avg_qty, ps.min_qty, ps.max_qty,
  ps.total_spent_mxn AS total_spent,         -- alias for backward compat (now MXN)
  ps.total_spent_mxn,
  ps.total_spent_native,
  ps.last_purchase_date, ps.first_purchase_date,
  lp.last_price, lp.last_qty, lp.last_supplier, lp.last_order_name,
  pp.prev_price,
  CASE
    WHEN pp.prev_price > 0
    THEN ROUND((lp.last_price - pp.prev_price) / pp.prev_price * 100, 1)
    ELSE NULL
  END AS price_change_pct,
  CASE
    WHEN ps.avg_price > 0
    THEN ROUND((lp.last_price - ps.avg_price) / ps.avg_price * 100, 1)
    ELSE NULL
  END AS price_vs_avg_pct,
  CASE
    WHEN ps.avg_qty > 0
    THEN ROUND((lp.last_qty - ps.avg_qty) / ps.avg_qty * 100, 1)
    ELSE NULL
  END AS qty_vs_avg_pct,
  CASE
    WHEN ps.avg_price > 0 AND lp.last_price > ps.avg_price * 1.15 THEN 'price_above_avg'
    WHEN ps.avg_price > 0 AND lp.last_price < ps.avg_price * 0.85 THEN 'price_below_avg'
    ELSE 'price_normal'
  END AS price_flag,
  CASE
    WHEN ps.avg_qty > 0 AND lp.last_qty > ps.avg_qty * 3 THEN 'qty_spike'
    WHEN ps.avg_qty > 0 AND lp.last_qty < ps.avg_qty * 0.3 THEN 'qty_drop'
    ELSE 'qty_normal'
  END AS qty_flag
FROM product_stats ps
JOIN latest_purchases lp
  ON lp.odoo_product_id = ps.odoo_product_id AND lp.currency = ps.currency
LEFT JOIN previous_purchases pp
  ON pp.odoo_product_id = ps.odoo_product_id AND pp.currency = ps.currency
ORDER BY ps.total_spent_mxn DESC;

CREATE INDEX idx_ppi_product ON purchase_price_intelligence(odoo_product_id);
CREATE INDEX idx_ppi_total_spent ON purchase_price_intelligence(total_spent_mxn DESC);

COMMENT ON MATERIALIZED VIEW purchase_price_intelligence IS
  'Sprint 13f: total_spent now uses subtotal_mxn for cross-product roll-ups. avg/min/max prices stay in native currency (still grouped per currency). total_spent_native preserved for legacy reference.';
