-- ═══════════════════════════════════════════════════════════════
-- H15b — customer_margin_analysis: excluir líneas costless
-- ═══════════════════════════════════════════════════════════════
-- Audit finding (DATA_AUDIT_REPORT.md §H15):
-- "leasing lepezo" (company_id=116947) aparece en /ventas top
-- customers con 100% margin y $17.2M revenue 12m. Root cause:
-- factura INV/2026/03/0173 de $11.3M es asset leasing, no venta
-- de productos. Las líneas no tienen odoo_product_id o tienen
-- cost=0, entonces line_margin = line_revenue → 100% margin.
--
-- Fix: filtrar a nivel línea en el CTE `line_margin`:
--   AND il.odoo_product_id IS NOT NULL
--   AND COALESCE(prc.real_unit_cost, p.avg_cost, p.standard_price, 0) > 0
--
-- Companies con SOLO líneas asset-sin-producto quedan fuera de la
-- MV. Companies con mezcla de ventas reales + leasing quedan con
-- margen de las ventas reales solamente (correcto).
--
-- Base: def de 20260414_sprint13f_audit_fixes_batch.sql:27 con
-- solo el WHERE ampliado.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

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
    COALESCE(prc.real_unit_cost, p.avg_cost, p.standard_price, 0) AS unit_cost,
    il.quantity
      * COALESCE(prc.real_unit_cost, p.avg_cost, p.standard_price, 0) AS line_cost,
    COALESCE(il.price_subtotal_mxn, il.price_subtotal)
      - il.quantity
        * COALESCE(prc.real_unit_cost, p.avg_cost, p.standard_price, 0) AS line_margin,
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
    -- H15b: solo líneas que SÍ son venta de producto con costo conocido.
    AND il.odoo_product_id IS NOT NULL
    AND COALESCE(prc.real_unit_cost, p.avg_cost, p.standard_price, 0) > 0
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
  COUNT(*) FILTER (WHERE cost_source = 'bom') AS lines_with_bom_cost,
  COUNT(*) FILTER (WHERE cost_source = 'standard') AS lines_with_standard_cost,
  COUNT(*) FILTER (WHERE cost_source = 'avg_cost') AS lines_with_avg_cost,
  -- H15b: cost_source='none' ya no puede aparecer (filtrado arriba), pero
  -- dejamos la columna por compatibilidad con consumers del audit.
  0::bigint AS lines_with_no_cost
FROM line_margin
GROUP BY company_id, company_name;

CREATE UNIQUE INDEX idx_customer_margin_analysis_pk ON customer_margin_analysis (company_id);
CREATE INDEX idx_customer_margin_analysis_revenue ON customer_margin_analysis (revenue_12m DESC NULLS LAST);

COMMIT;
