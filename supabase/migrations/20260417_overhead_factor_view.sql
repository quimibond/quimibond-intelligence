-- Overhead Factor 12m: compara margen contable (P&L) vs margen material
-- calculado via BOM + standard_price de invoice_lines.
-- Aplicada en prod via MCP: `overhead_factor_view_v2b`.
--
-- Descubrimiento: post-refresh de customer_margin_analysis, overhead
-- factor ≈ 0. Significa que el cost basis (BOM + standard_price) YA
-- captura COGS correctamente al nivel agregado. Los 70% "margen"
-- anteriores eran data stale de CMA. Post-refresh: CMA aggregate
-- 18.9% = P&L 18.3%.
--
-- La view se queda como monitoring tool: si algún día el factor se
-- desvía de 0 (ej. qb19 deja de sincronizar avg_cost), la view lo
-- detecta y podemos agregar ajuste a CMA.

DROP VIEW IF EXISTS overhead_factor_12m;

CREATE OR REPLACE VIEW overhead_factor_12m AS
WITH pl AS (
  SELECT
    COALESCE(SUM(ingresos), 0)::numeric AS total_revenue_pl,
    COALESCE(SUM(costo_ventas), 0)::numeric AS total_cogs_pl,
    COALESCE(SUM(utilidad_bruta), 0)::numeric AS total_gross_profit_pl
  FROM pl_estado_resultados
  WHERE period >= to_char(CURRENT_DATE - INTERVAL '12 months', 'YYYY-MM')
    AND period < to_char(CURRENT_DATE, 'YYYY-MM')
),
material_12m AS (
  SELECT
    SUM(COALESCE(il.price_subtotal_mxn, il.price_subtotal))::numeric AS total_revenue,
    SUM(il.quantity * COALESCE(prc.real_unit_cost, p.avg_cost, p.standard_price, 0))::numeric AS total_material_cost
  FROM odoo_invoice_lines il
  LEFT JOIN odoo_products p ON p.odoo_product_id = il.odoo_product_id
  LEFT JOIN product_real_cost prc ON prc.odoo_product_id = il.odoo_product_id
  WHERE il.move_type = 'out_invoice'
    AND il.invoice_date >= CURRENT_DATE - INTERVAL '12 months'
    AND il.quantity > 0
    AND il.odoo_product_id IS NOT NULL
    AND COALESCE(prc.real_unit_cost, p.avg_cost, p.standard_price, 0) > 0
)
SELECT
  pl.total_revenue_pl,
  pl.total_cogs_pl,
  pl.total_gross_profit_pl,
  m.total_revenue AS total_revenue_lines,
  m.total_material_cost,
  GREATEST(pl.total_cogs_pl - m.total_material_cost, 0)::numeric AS overhead_cost_12m,
  CASE WHEN pl.total_revenue_pl > 0
    THEN ROUND(((pl.total_cogs_pl - m.total_material_cost) / pl.total_revenue_pl * 100)::numeric, 2)
    ELSE 0
  END AS overhead_factor_pct,
  CASE WHEN pl.total_revenue_pl > 0
    THEN ROUND((pl.total_gross_profit_pl / pl.total_revenue_pl * 100)::numeric, 2)
    ELSE 0
  END AS real_gross_margin_pct,
  CASE WHEN m.total_revenue > 0
    THEN ROUND(((m.total_revenue - m.total_material_cost) / m.total_revenue * 100)::numeric, 2)
    ELSE 0
  END AS material_margin_pct_avg,
  NOW() AS computed_at
FROM pl, material_12m m;

COMMENT ON VIEW overhead_factor_12m IS
  'Factor overhead 12m: (cogs_pl − material_cost) / revenue × 100. Monitoring: si ≠ 0, CMA necesita ajuste.';
