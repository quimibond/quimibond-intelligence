-- 2026-06-12f: entretelas TEJIDAS cargan tejido + tintorería (no solo carda).
--
-- Corrección al ruteo de 20260612c: no todas las entretelas son carda. La
-- familia "Puntos" (aplicación de resina) está mezclada: ~31 productos de base
-- TEJIDA (tejido circular) + ~15 de carda. Las tejidas (ZN4032, WP4032, WNS,
-- WNY, WR, WM, WTT 4032 — "Entretela de tejido circular fusionable") SÍ pasan
-- por tejido y tintorería; el ruteo carda-only las sub-costeaba ($2.3/m).
--
-- Regla:
--   - entretela TEJIDA (name ~ 'tejido circular' / 'tejida' sin 'no tejida'):
--       fab = peso_kg × factor_peso (tejido+tintorería) + factor_entretela
--             (acabado de entretela: puntos/fusión). SIN factor largo (acabado
--             de rama, que la entretela no usa).
--   - entretela CARDA (no tejida): solo factor_entretela (sin tejido/tintorería).
--   - tela: híbrido peso+largo como siempre.
--
-- Efecto: las tejidas suben de margen +37-40% a ~+7-12% (en línea con telas de
-- peso comparable). Las carda no cambian. Clasificador por nombre (corregible).
-- También incorpora operación por % de ventas (20260612e). Cache v21->v22.

CREATE OR REPLACE FUNCTION public.get_full_cost_reconstruction(p_period text)
 RETURNS TABLE(odoo_product_id integer, product_ref text, product_name text, uom text, qty_sold numeric, revenue_mxn numeric, costo_primo_unit_mxn numeric, factor_fab_unit_mxn numeric, factor_op_unit_mxn numeric, costo_total_unit_mxn numeric, costo_primo_total_mxn numeric, gastos_fab_total_mxn numeric, gastos_op_total_mxn numeric, costo_total_mxn numeric, pct_mp numeric, pct_fab numeric, pct_op numeric, margin_full_pct numeric, mp_source text, costo_primo_avg_unit_mxn numeric, costo_primo_avg_total_mxn numeric, kg_per_unit numeric, m_per_kg numeric)
 LANGUAGE sql STABLE
AS $function$
WITH factors AS (
  SELECT factor_fab_peso_kg_smooth AS fp, factor_fab_largo_m_smooth AS fl
  FROM public.get_cost_factors_monthly(48) WHERE mes = p_period LIMIT 1
),
fent AS (
  SELECT factor_ent_m_smooth AS fe FROM public.get_entretela_fab_factor_monthly(48) WHERE mes = p_period LIMIT 1
),
op_pct AS (
  SELECT SUM(gp.op_pool) / NULLIF(SUM(rv.rev),0) AS pct
  FROM (
    SELECT period AS mes, SUM(balance) FILTER (WHERE account_code LIKE '6%') AS op_pool
    FROM public.odoo_account_balances
    WHERE period <= p_period
      AND period > to_char(((p_period||'-01')::date - interval '12 months'),'YYYY-MM')
    GROUP BY 1
  ) gp
  JOIN (
    SELECT to_char(invoice_date,'YYYY-MM') AS mes, SUM(price_subtotal_mxn) AS rev
    FROM public.odoo_invoice_lines
    WHERE move_type='out_invoice'
      AND invoice_date < (((p_period||'-01')::date) + interval '1 month')
      AND invoice_date >= (((p_period||'-01')::date) - interval '11 months')
    GROUP BY 1
  ) rv ON rv.mes = gp.mes
  WHERE gp.op_pool > 0 AND rv.rev > 0
),
d_from AS (SELECT (p_period || '-01')::date AS df),
all_lines AS (
  SELECT il.odoo_move_id, il.odoo_product_id, il.quantity, il.price_subtotal_mxn
  FROM public.odoo_invoice_lines il, d_from
  WHERE il.move_type = 'out_invoice' AND il.invoice_date >= d_from.df
    AND il.invoice_date < (d_from.df + interval '1 month') AND il.odoo_product_id IS NOT NULL
),
rev AS (SELECT odoo_product_id::int AS pid, SUM(COALESCE(price_subtotal_mxn,0))::numeric AS revenue FROM all_lines GROUP BY 1),
qty AS (
  SELECT odoo_product_id::int AS pid, SUM(quantity)::numeric AS qty_sold
  FROM (SELECT DISTINCT ON (odoo_move_id, odoo_product_id, quantity) odoo_move_id, odoo_product_id, quantity FROM all_lines) d
  GROUP BY 1
),
base AS (
  SELECT COALESCE(r.pid, q.pid) AS pid, cp.internal_ref AS product_ref, cp.display_name AS product_name,
    op.uom, COALESCE(q.qty_sold, 0) AS qty_sold, COALESCE(r.revenue, 0) AS revenue,
    public.get_bom_mp_cost_lastcost(COALESCE(r.pid, q.pid)) AS primo_unit,
    public.get_bom_raw_material_cost_per_unit(COALESCE(r.pid, q.pid)) AS primo_avg_unit,
    COALESCE(kpu.kg_per_unit, 0) AS conv,
    COALESCE(puc.m_per_kg, 0) AS m_per_kg,
    (cp.internal_ref ~ ' I$') AS is_import,
    (op.category ILIKE '%Entretela%' AND op.category NOT ILIKE '%Importaci%') AS is_entretela,
    (op.category ILIKE '%Entretela%' AND op.category NOT ILIKE '%Importaci%'
      AND (op.name ILIKE '%tejido circular%' OR (op.name ILIKE '%tejida%' AND op.name NOT ILIKE '%no tejida%'))) AS is_tejida_ent,
    (cp.is_byproduct OR cp.internal_ref ~* '^\s*(SALDO|DESPERDICIO)') AS is_byproduct,
    CASE
      WHEN cp.is_byproduct OR cp.internal_ref ~* '^\s*(SALDO|DESPERDICIO)' THEN 'subproducto_cero'
      WHEN cp.internal_ref ~ ' I$' THEN 'importado_ultima_compra'
      WHEN EXISTS (SELECT 1 FROM public.mv_primary_bom pb WHERE pb.odoo_product_id = COALESCE(r.pid,q.pid)) THEN 'bom_recursivo'
      WHEN EXISTS (SELECT 1 FROM public.odoo_order_lines ol WHERE ol.order_type='purchase' AND ol.odoo_product_id=COALESCE(r.pid,q.pid) AND ol.qty>0 AND ol.subtotal_mxn>0) THEN 'ultima_compra'
      ELSE 'avg_cost_fallback'
    END AS mp_source
  FROM rev r
  FULL OUTER JOIN qty q ON q.pid = r.pid
  LEFT JOIN public.canonical_products cp ON cp.odoo_product_id = COALESCE(r.pid, q.pid)
  LEFT JOIN public.odoo_products op ON op.odoo_product_id = COALESCE(r.pid, q.pid)
  LEFT JOIN public.product_kg_per_unit kpu ON kpu.odoo_product_id = COALESCE(r.pid, q.pid)
  LEFT JOIN public.product_uom_conversion puc ON puc.odoo_product_id = COALESCE(r.pid, q.pid)
),
calc AS (
  SELECT b.*,
    CASE WHEN b.is_import THEN 0
         WHEN b.is_tejida_ent AND (SELECT fe FROM fent) IS NOT NULL AND b.uom='m'
              THEN b.conv*COALESCE((SELECT fp FROM factors),0) + COALESCE((SELECT fe FROM fent),0)
         WHEN b.is_tejida_ent AND (SELECT fe FROM fent) IS NOT NULL AND b.uom='kg'
              THEN COALESCE((SELECT fp FROM factors),0) + b.m_per_kg*COALESCE((SELECT fe FROM fent),0)
         WHEN b.is_entretela AND (SELECT fe FROM fent) IS NOT NULL AND b.uom='m' THEN COALESCE((SELECT fe FROM fent),0)
         WHEN b.is_entretela AND (SELECT fe FROM fent) IS NOT NULL AND b.uom='kg' THEN COALESCE((SELECT fe FROM fent),0) * b.m_per_kg
         WHEN b.uom='m' THEN b.conv*COALESCE((SELECT fp FROM factors),0) + COALESCE((SELECT fl FROM factors),0)
         WHEN b.uom='kg' THEN COALESCE((SELECT fp FROM factors),0) + b.m_per_kg*COALESCE((SELECT fl FROM factors),0)
         ELSE 0 END AS fab_unit,
    CASE WHEN b.qty_sold > 0 THEN COALESCE((SELECT pct FROM op_pct),0) * b.revenue / b.qty_sold ELSE 0 END AS op_unit
  FROM base b
)
SELECT
  c.pid, c.product_ref, c.product_name, c.uom, c.qty_sold, ROUND(c.revenue, 2),
  ROUND(c.primo_unit, 4), ROUND(c.fab_unit, 4), ROUND(c.op_unit, 4),
  ROUND(c.primo_unit + c.fab_unit + c.op_unit, 4),
  ROUND(c.qty_sold * c.primo_unit, 2), ROUND(c.qty_sold * c.fab_unit, 2),
  ROUND(c.qty_sold * c.op_unit, 2),
  ROUND(c.qty_sold * (c.primo_unit + c.fab_unit + c.op_unit), 2),
  CASE WHEN (c.primo_unit + c.fab_unit + c.op_unit) > 0 THEN ROUND(c.primo_unit / (c.primo_unit + c.fab_unit + c.op_unit) * 100, 1) END,
  CASE WHEN (c.primo_unit + c.fab_unit + c.op_unit) > 0 THEN ROUND(c.fab_unit / (c.primo_unit + c.fab_unit + c.op_unit) * 100, 1) END,
  CASE WHEN (c.primo_unit + c.fab_unit + c.op_unit) > 0 THEN ROUND(c.op_unit / (c.primo_unit + c.fab_unit + c.op_unit) * 100, 1) END,
  CASE WHEN c.revenue > 0 THEN ROUND((c.revenue - c.qty_sold * (c.primo_unit + c.fab_unit + c.op_unit)) / c.revenue * 100, 1) END,
  c.mp_source, ROUND(c.primo_avg_unit, 4), ROUND(c.qty_sold * c.primo_avg_unit, 2),
  ROUND(c.conv, 5), ROUND(c.m_per_kg, 5)
FROM calc c
WHERE (c.qty_sold <> 0 OR c.revenue <> 0) AND NOT c.is_byproduct;
$function$;
