-- CMA + overhead_factor · fix reversal cost sign bug
-- ====================================================
-- Aplicada en prod via MCP con safe_recreate_matview (primera prueba
-- del wrapper — funcionó ✓). Migración `cma_fix_reversal_cost_sign`
-- y `overhead_factor_fix_sign`.
--
-- Usuario reportó que Contitech -27.9% no hacía sentido. Investigación:
--
-- Bug: En Odoo 17+, credit notes pueden ser `out_invoice` con
-- `price_subtotal` NEGATIVO (reversal) en vez de `out_refund`. CMA
-- calculaba line_cost SIEMPRE positivo (`quantity × unit_cost`),
-- pero revenue respetaba el signo negativo. Resultado:
--
--   Venta original:    revenue +$14M, cost +$534K → margin +$13.5M
--   Reversal (neg):    revenue -$14M, cost +$534K ← BUG: cost ignora signo
--                      margin -$14.5M (wrong: double-count cost)
--
-- Fix: line_cost hereda SIGN() del revenue. Reversals correctamente
-- cancelan tanto revenue como cost.
--
--   Venta:    revenue +$14M, cost +$534K, margin +$13.5M
--   Reversal: revenue -$14M, cost -$534K, margin -$13.5M (cancela)
--
-- Efecto: Contitech pasa de "-27.9% pérdida" (falso) a "56.3% margen
-- material" o "4.4% real" (correcto, delgado pero positivo).
--
-- Consecuencia secundaria: ahora overhead_factor_pct se revela
-- correctamente = 51.89% (antes ~0% porque el bug compensaba).
-- Eso permite calcular adjusted_margin = material − overhead_factor
-- que matches el P&L contable.

-- CMA con sign fix
DROP MATERIALIZED VIEW IF EXISTS customer_margin_analysis CASCADE;

CREATE MATERIALIZED VIEW customer_margin_analysis AS
WITH line_margin AS (
  SELECT il.odoo_partner_id, il.company_id, co.canonical_name AS company_name,
    il.odoo_product_id, il.product_name, il.product_ref, il.invoice_date,
    date_trunc('month'::text, il.invoice_date::timestamp with time zone)::date AS month,
    il.quantity, il.price_unit AS sale_price,
    COALESCE(il.price_subtotal_mxn, il.price_subtotal) AS line_revenue,
    COALESCE(prc.real_unit_cost, p.avg_cost, p.standard_price, 0::numeric) AS unit_cost,
    -- FIX: cost hereda signo de price_subtotal
    (SIGN(COALESCE(il.price_subtotal_mxn, il.price_subtotal)) * il.quantity
     * COALESCE(prc.real_unit_cost, p.avg_cost, p.standard_price, 0::numeric)) AS line_cost,
    (COALESCE(il.price_subtotal_mxn, il.price_subtotal)
     - SIGN(COALESCE(il.price_subtotal_mxn, il.price_subtotal)) * il.quantity
       * COALESCE(prc.real_unit_cost, p.avg_cost, p.standard_price, 0::numeric)) AS line_margin,
    CASE
      WHEN prc.real_unit_cost IS NOT NULL THEN 'bom'::text
      WHEN COALESCE(p.avg_cost, 0::numeric) > 0::numeric THEN 'avg_cost'::text
      WHEN COALESCE(p.standard_price, 0::numeric) > 0::numeric THEN 'standard'::text
      ELSE 'none'::text
    END AS cost_source
  FROM odoo_invoice_lines il
  LEFT JOIN companies co ON co.id = il.company_id
  LEFT JOIN odoo_products p ON p.odoo_product_id = il.odoo_product_id
  LEFT JOIN product_real_cost prc ON prc.odoo_product_id = il.odoo_product_id
  WHERE il.move_type = 'out_invoice'::text
    AND il.company_id IS NOT NULL
    AND il.invoice_date IS NOT NULL
    AND il.quantity > 0::numeric
    AND il.odoo_product_id IS NOT NULL
    AND COALESCE(prc.real_unit_cost, p.avg_cost, p.standard_price, 0::numeric) > 0::numeric
)
SELECT company_id, company_name,
  count(DISTINCT odoo_product_id) AS distinct_products,
  count(*) AS total_lines,
  round(sum(line_revenue), 0) AS total_revenue,
  round(sum(line_cost), 0) AS total_cost,
  round(sum(line_margin), 0) AS total_margin,
  CASE WHEN sum(line_revenue) > 0::numeric
    THEN round(sum(line_margin) / sum(line_revenue) * 100::numeric, 1)
    ELSE 0::numeric END AS margin_pct,
  round(sum(CASE WHEN invoice_date >= (CURRENT_DATE - 365) THEN line_revenue ELSE 0::numeric END), 0) AS revenue_12m,
  round(sum(CASE WHEN invoice_date >= (CURRENT_DATE - 365) THEN line_margin  ELSE 0::numeric END), 0) AS margin_12m,
  CASE WHEN sum(CASE WHEN invoice_date >= (CURRENT_DATE - 365) THEN line_revenue ELSE 0::numeric END) > 0::numeric
    THEN round(sum(CASE WHEN invoice_date >= (CURRENT_DATE - 365) THEN line_margin ELSE 0::numeric END)
             / sum(CASE WHEN invoice_date >= (CURRENT_DATE - 365) THEN line_revenue ELSE 0::numeric END) * 100::numeric, 1)
    ELSE 0::numeric END AS margin_pct_12m,
  count(*) FILTER (WHERE cost_source = 'bom'::text) AS lines_with_bom_cost,
  count(*) FILTER (WHERE cost_source = 'standard'::text) AS lines_with_standard_cost,
  count(*) FILTER (WHERE cost_source = 'avg_cost'::text) AS lines_with_avg_cost,
  0::bigint AS lines_with_no_cost
FROM line_margin
GROUP BY company_id, company_name;

CREATE UNIQUE INDEX idx_customer_margin_analysis_pk ON customer_margin_analysis (company_id);
CREATE INDEX idx_customer_margin_analysis_revenue ON customer_margin_analysis (revenue_12m DESC NULLS LAST);

-- overhead_factor con mismo sign fix
DROP VIEW IF EXISTS overhead_factor_12m;
CREATE OR REPLACE VIEW overhead_factor_12m AS
WITH pl AS (
  SELECT COALESCE(SUM(ingresos), 0)::numeric AS total_revenue_pl,
    COALESCE(SUM(costo_ventas), 0)::numeric AS total_cogs_pl,
    COALESCE(SUM(utilidad_bruta), 0)::numeric AS total_gross_profit_pl
  FROM pl_estado_resultados
  WHERE period >= to_char(CURRENT_DATE - INTERVAL '12 months', 'YYYY-MM')
    AND period < to_char(CURRENT_DATE, 'YYYY-MM')
),
material_12m AS (
  SELECT SUM(COALESCE(il.price_subtotal_mxn, il.price_subtotal))::numeric AS total_revenue,
    SUM(SIGN(COALESCE(il.price_subtotal_mxn, il.price_subtotal)) * il.quantity
        * COALESCE(prc.real_unit_cost, p.avg_cost, p.standard_price, 0))::numeric AS total_material_cost
  FROM odoo_invoice_lines il
  LEFT JOIN odoo_products p ON p.odoo_product_id = il.odoo_product_id
  LEFT JOIN product_real_cost prc ON prc.odoo_product_id = il.odoo_product_id
  WHERE il.move_type = 'out_invoice'
    AND il.invoice_date >= CURRENT_DATE - INTERVAL '12 months'
    AND il.quantity > 0 AND il.odoo_product_id IS NOT NULL
    AND COALESCE(prc.real_unit_cost, p.avg_cost, p.standard_price, 0) > 0
)
SELECT pl.total_revenue_pl, pl.total_cogs_pl, pl.total_gross_profit_pl,
  m.total_revenue AS total_revenue_lines, m.total_material_cost,
  GREATEST(pl.total_cogs_pl - m.total_material_cost, 0)::numeric AS overhead_cost_12m,
  CASE WHEN pl.total_revenue_pl > 0
    THEN ROUND(((pl.total_cogs_pl - m.total_material_cost) / pl.total_revenue_pl * 100)::numeric, 2)
    ELSE 0 END AS overhead_factor_pct,
  CASE WHEN pl.total_revenue_pl > 0
    THEN ROUND((pl.total_gross_profit_pl / pl.total_revenue_pl * 100)::numeric, 2)
    ELSE 0 END AS real_gross_margin_pct,
  CASE WHEN m.total_revenue > 0
    THEN ROUND(((m.total_revenue - m.total_material_cost) / m.total_revenue * 100)::numeric, 2)
    ELSE 0 END AS material_margin_pct_avg,
  NOW() AS computed_at
FROM pl, material_12m m;
