-- 2026-06-12c: ruteo de fabricación por PROCESO para entretelas.
--
-- Problema: el costo reconstruido aplicaba un factor de fabricación blendeado
-- (tejido circular + tintorería + acabado/rama, ~$5.5/m) a TODOS los productos
-- en metros. Las entretelas NO pasan por ese tren: se fabrican en carda /
-- puntos (aplicación de resina) / espolvoreo / perfoquim / impregnación /
-- termofijado, todo capturado en el centro de costo ENTRETELAS. El blendeado
-- las sobre-costeaba (A70BL155: fab $5.47/m falso vs ~$2.3/m real).
--
-- Las familias se identifican por la CATEGORÍA de Odoo:
--   'Producto .../ Entretelas-...-{Carda|Puntos|Espolvoreo|Perfoquim|
--    Impregnación|Termofijado}-mts/kg'  (excluye '-Importación', esos ya van
--   con fab=0 por el guard de importado).
--
-- Factor entretela ($/m) = (MOD centro ENTRETELAS + renta contractual Lote 10
-- $352,062/mes + overhead extra configurable) ÷ metros de entretela producidos,
-- suavizado 12m. ~$2.3/m en 2026 (cuadra con el ~$2.05 documentado).
--
-- ALCANCE (Fase 1): se rutean las entretelas a su factor propio. El pool de
-- tela (get_cost_factors_monthly) se deja intacto — sigue incluyendo el MOD+
-- renta de entretelas (~$427k/mes, ~8% del pool) y los metros de entretela en
-- el denominador (se compensan parcialmente porque la entretela es ligera).
-- Una Fase 2 (con visto bueno) migraría todo a costeo por centro para el split
-- quirúrgico del GL. La luz de la carda NO se separó: los energéticos no
-- corre­lacionan con la producción de carda (OP-CAR feb-2026+, energéticos
-- planos $5-53k/mes dominados por tejido) -> queda como knob 'entretela_
-- overhead_extra_mxn' (default 0) para que el CEO lo ajuste si lo cuantifica.

-- 1) knob de overhead extra (energía carda/puntos + depreciación máquinas)
INSERT INTO public.costing_config(key, value, notes) VALUES
  ('entretela_overhead_extra_mxn', 0,
   'Overhead mensual extra de entretelas (energia carda/puntos + deprec maquinas). Default 0; CEO ajusta. MOD y renta Lote 10 ya se incluyen aparte en get_entretela_fab_factor_monthly.')
ON CONFLICT (key) DO NOTHING;

-- 2) factor de fabricación de ENTRETELAS ($/m), suavizado 12m
CREATE OR REPLACE FUNCTION public.get_entretela_fab_factor_monthly(p_months_back integer DEFAULT 12)
RETURNS TABLE(mes text, costo_ent_mxn numeric, metros_ent numeric, factor_ent_m numeric, factor_ent_m_smooth numeric)
LANGUAGE sql STABLE AS $function$
WITH months AS (
  SELECT to_char(gs,'YYYY-MM') AS mes
  FROM generate_series(date_trunc('month',CURRENT_DATE)-(p_months_back-1)*interval '1 month',
       date_trunc('month',CURRENT_DATE), interval '1 month') gs
),
rent AS (
  SELECT COALESCE(sum(monthly_amount_mxn*allocation_pct/100),0) AS r
  FROM public.rent_lot_assignment WHERE cost_center_code='ENTRETELAS'
),
extra AS (
  SELECT COALESCE((SELECT value FROM public.costing_config WHERE key='entretela_overhead_extra_mxn'),0) AS e
),
prod AS (
  SELECT to_char(m.date_finished,'YYYY-MM') AS mes, SUM(m.qty_produced) AS metros
  FROM public.odoo_manufacturing m
  JOIN public.odoo_products op ON op.odoo_product_id=m.odoo_product_id
  WHERE m.state='done' AND m.qty_produced>0 AND op.uom='m'
    AND op.category ILIKE '%Entretela%' AND op.category NOT ILIKE '%Importaci%'
  GROUP BY 1
),
nom AS (  -- solo meses con produccion de entretela (evita llamar get_nomina 48x)
  SELECT pr.mes,
    COALESCE((SELECT sum(n.total_nomina_mxn) FROM public.get_nomina_by_cost_center(pr.mes) n
              WHERE n.cost_center_code='ENTRETELAS'),0) AS nomina
  FROM (SELECT DISTINCT mes FROM prod) pr
),
base AS (
  SELECT mo.mes,
    COALESCE(n.nomina,0) + (SELECT r FROM rent) + (SELECT e FROM extra) AS costo,
    COALESCE(p.metros,0) AS metros
  FROM months mo
  LEFT JOIN prod p ON p.mes=mo.mes
  LEFT JOIN nom n ON n.mes=mo.mes
)
SELECT b.mes, ROUND(b.costo,2), ROUND(b.metros,0),
  CASE WHEN b.metros>0 THEN ROUND(b.costo/b.metros,4) END,
  ROUND( (SUM(CASE WHEN b.metros>0 THEN b.costo ELSE 0 END) OVER w)
       / NULLIF(SUM(CASE WHEN b.metros>0 THEN b.metros ELSE 0 END) OVER w,0), 4)
FROM base b
WINDOW w AS (ORDER BY b.mes ROWS BETWEEN 11 PRECEDING AND CURRENT ROW)
ORDER BY b.mes;
$function$;

-- 3) get_full_cost_reconstruction: rutear entretelas a su factor
CREATE OR REPLACE FUNCTION public.get_full_cost_reconstruction(p_period text)
 RETURNS TABLE(odoo_product_id integer, product_ref text, product_name text, uom text, qty_sold numeric, revenue_mxn numeric, costo_primo_unit_mxn numeric, factor_fab_unit_mxn numeric, factor_op_unit_mxn numeric, costo_total_unit_mxn numeric, costo_primo_total_mxn numeric, gastos_fab_total_mxn numeric, gastos_op_total_mxn numeric, costo_total_mxn numeric, pct_mp numeric, pct_fab numeric, pct_op numeric, margin_full_pct numeric, mp_source text, costo_primo_avg_unit_mxn numeric, costo_primo_avg_total_mxn numeric, kg_per_unit numeric, m_per_kg numeric)
 LANGUAGE sql STABLE
AS $function$
WITH factors AS (
  SELECT factor_fab_peso_kg_smooth AS fp, factor_fab_largo_m_smooth AS fl, factor_op_kg_smooth AS fo
  FROM public.get_cost_factors_monthly(48) WHERE mes = p_period LIMIT 1
),
fent AS (
  SELECT factor_ent_m_smooth AS fe FROM public.get_entretela_fab_factor_monthly(48) WHERE mes = p_period LIMIT 1
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
         WHEN b.is_entretela AND (SELECT fe FROM fent) IS NOT NULL AND b.uom='m' THEN COALESCE((SELECT fe FROM fent),0)
         WHEN b.is_entretela AND (SELECT fe FROM fent) IS NOT NULL AND b.uom='kg' THEN COALESCE((SELECT fe FROM fent),0) * b.m_per_kg
         WHEN b.uom='m' THEN b.conv*COALESCE((SELECT fp FROM factors),0) + COALESCE((SELECT fl FROM factors),0)
         WHEN b.uom='kg' THEN COALESCE((SELECT fp FROM factors),0) + b.m_per_kg*COALESCE((SELECT fl FROM factors),0)
         ELSE 0 END AS fab_unit,
    COALESCE((SELECT fo FROM factors),0) * b.conv AS op_unit
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
