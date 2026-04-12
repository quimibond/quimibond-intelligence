-- Vista: invoice_line_margins
-- Detección de eventos PUNTUALES de margen bajo / venta bajo costo en los últimos 90 días.
-- Complementa product_margin_analysis (que es agregado) con resolución a nivel factura+línea.

CREATE OR REPLACE VIEW invoice_line_margins AS
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
    il.price_subtotal,
    p.standard_price,
    p.avg_cost,
    COALESCE(NULLIF(p.avg_cost, 0), p.standard_price) AS unit_cost
  FROM odoo_invoice_lines il
  LEFT JOIN odoo_products p ON p.odoo_product_id = il.odoo_product_id
  WHERE il.move_type = 'out_invoice'
    AND il.invoice_date IS NOT NULL
    AND il.invoice_date >= (CURRENT_DATE - INTERVAL '90 days')
    AND il.quantity > 0
    AND il.price_unit > 0
),
computed AS (
  SELECT
    b.*,
    (b.price_unit - b.unit_cost) AS margin_per_unit,
    CASE
      WHEN b.unit_cost IS NULL OR b.unit_cost = 0 THEN NULL
      ELSE ROUND(((b.price_unit - b.unit_cost) / b.price_unit * 100)::numeric, 1)
    END AS gross_margin_pct,
    (b.price_unit < b.unit_cost) AS below_cost,
    (b.quantity * (b.price_unit - b.unit_cost)) AS margin_total
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
  c.gross_margin_pct,
  c.below_cost,
  c.margin_total,
  c.price_subtotal
FROM computed c
LEFT JOIN companies co ON co.id = c.company_id
WHERE c.gross_margin_pct IS NOT NULL
  AND c.gross_margin_pct > -100  -- exclude unit-mismatch false positives (real below-cost rarely exceeds -100%)
  AND (
    c.gross_margin_pct < 15
    OR c.below_cost = true
    OR c.discount > 20
  )
ORDER BY
  c.below_cost DESC,
  c.gross_margin_pct ASC NULLS LAST;

COMMENT ON VIEW invoice_line_margins IS
  'Lineas de factura de venta con margen <15%, bajo costo, o descuento >20% (ultimos 90d). Complementa product_margin_analysis con eventos puntuales.';
