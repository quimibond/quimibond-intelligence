-- 2026-06-12g: corrige doble conteo de entretelas tejidas en el pool de tela.
--
-- Hallazgo de auditoria (costo por depto/familia): la fabricacion absorbida
-- sobre-pasaba el GL. Causa: en la Fase 2 (20260612d) saque del denominador de
-- PESO del pool de tela TODOS los kg de entretela. Pero las entretelas TEJIDAS
-- (tejido circular) SI consumen tejido+tintoreria y SI pagan la tarifa de peso.
-- Al estar su kg fuera del denominador pero cobrandoles la tarifa, su costo de
-- tejido se contaba 2 veces (en el pool que pagan las telas + en el cobro a la
-- tejida). Sobre-absorcion ~$295k/mes.
--
-- Fix: del denominador de PESO solo se restan los kg de entretela CARDA (no
-- tejida) — esas no usan tejido/tintoreria. Las tejidas se quedan en el
-- denominador (consumen esos procesos). El denominador de LARGO sigue restando
-- TODOS los metros de entretela (ninguna usa rama/acabado). El numerador sigue
-- restando el costo del centro ENTRETELAS (carda+puntos, via factor entretela).
--
-- Efecto: fp baja un poco (mas kg en el denominador) -> telas y tejidas pagan
-- algo menos de fab (X140 $12.87->$11.86). La sobre-absorcion residual (~$754k
-- en mayo) es SUAVIZADO: el GL de mayo ($3.9M) esta ~30% bajo el promedio 12m
-- (~$5.9M) por timing de renta; se promedia en el ano. Cache v22->v23.

CREATE OR REPLACE FUNCTION public.get_cost_factors_monthly(p_months_back integer DEFAULT 12)
 RETURNS TABLE(mes text, metros_referencia numeric, metros_inspeccion numeric, metros_vendidos_equiv numeric, gastos_fabricacion_mxn numeric, gastos_operacion_mxn numeric, factor_fab_x_metro numeric, factor_op_x_metro numeric, factor_total_x_metro numeric, factor_fab_insp numeric, factor_op_insp numeric, factor_total_insp numeric, factor_op_vendido numeric, kg_inspeccion numeric, kg_vendidos numeric, factor_fab_kg numeric, factor_op_kg numeric, factor_total_kg numeric, factor_fab_kg_smooth numeric, factor_op_kg_smooth numeric, factor_total_kg_smooth numeric, factor_fab_peso_kg_smooth numeric, factor_fab_largo_m_smooth numeric)
 LANGUAGE sql STABLE
AS $function$
WITH cfg AS (SELECT COALESCE((SELECT value FROM public.costing_config WHERE key='fab_weight_share'),0.47) AS ws),
rent_ent AS (SELECT COALESCE(sum(monthly_amount_mxn*allocation_pct/100),0) AS r FROM public.rent_lot_assignment WHERE cost_center_code='ENTRETELAS'),
months AS (
  SELECT to_char(gs, 'YYYY-MM') AS mes
  FROM generate_series(date_trunc('month', CURRENT_DATE) - (p_months_back - 1) * interval '1 month',
    date_trunc('month', CURRENT_DATE), interval '1 month') gs
),
metros AS (
  SELECT to_char(date_finished, 'YYYY-MM') AS mes, SUM(qty_produced) AS m
  FROM public.odoo_manufacturing
  WHERE (name LIKE 'TL/OP-ACA%' OR name LIKE 'TL/OP-V10%') AND state='done' AND qty_produced>0 GROUP BY 1
),
insp AS (
  SELECT to_char(csm.date,'YYYY-MM') AS mes, SUM(csm.quantity) AS m,
         SUM(csm.quantity * kpu.kg_per_unit) FILTER (WHERE cp.internal_ref !~ ' I$' OR cp.internal_ref IS NULL) AS kg,
         SUM(csm.quantity) FILTER (WHERE op.category ILIKE '%Entretela%' AND op.category NOT ILIKE '%Importaci%') AS m_ent,
         SUM(csm.quantity * kpu.kg_per_unit) FILTER (
            WHERE (cp.internal_ref !~ ' I$' OR cp.internal_ref IS NULL)
              AND op.category ILIKE '%Entretela%' AND op.category NOT ILIKE '%Importaci%'
              AND NOT (op.name ILIKE '%tejido circular%' OR (op.name ILIKE '%tejida%' AND op.name NOT ILIKE '%no tejida%'))
         ) AS kg_ent_carda
  FROM public.canonical_stock_moves csm
  LEFT JOIN public.odoo_products op ON op.odoo_product_id=csm.odoo_product_id
  LEFT JOIN public.canonical_products cp ON cp.odoo_product_id=csm.odoo_product_id
  LEFT JOIN public.product_kg_per_unit kpu ON kpu.odoo_product_id=csm.odoo_product_id
  WHERE csm.reference LIKE 'TL/INSP%' AND csm.state='done'
    AND csm.date >= date_trunc('month', CURRENT_DATE) - p_months_back * interval '1 month'
    AND csm.quantity>0 AND (op.uom='m' OR op.uom IS NULL)
  GROUP BY 1
),
ventas AS (
  SELECT to_char(il.invoice_date,'YYYY-MM') AS mes,
    SUM(CASE WHEN op.uom='m' THEN il.quantity WHEN op.uom='kg' THEN il.quantity*COALESCE(puc.m_per_kg,0) ELSE 0 END) AS m_equiv,
    SUM(il.quantity * COALESCE(kpu.kg_per_unit,0)) AS kg
  FROM (SELECT DISTINCT ON (odoo_move_id, odoo_product_id, quantity) odoo_move_id, odoo_product_id, quantity, invoice_date
        FROM public.odoo_invoice_lines WHERE move_type='out_invoice' AND odoo_product_id IS NOT NULL) il
  LEFT JOIN public.odoo_products op ON op.odoo_product_id=il.odoo_product_id
  LEFT JOIN public.product_uom_conversion puc ON puc.odoo_product_id=il.odoo_product_id
  LEFT JOIN public.product_kg_per_unit kpu ON kpu.odoo_product_id=il.odoo_product_id
  GROUP BY 1
),
gastos AS (
  SELECT period AS mes,
    SUM(balance) FILTER (WHERE account_code LIKE '501.06%' OR account_code LIKE '504.01%'
      OR account_code ~ '^504\.(0[89]|1[0-9]|2[0-3])') AS fab,
    SUM(balance) FILTER (WHERE account_code LIKE '6%') AS op
  FROM public.odoo_account_balances GROUP BY 1
),
ent AS (
  SELECT mo.mes,
    COALESCE((SELECT sum(n.total_nomina_mxn) FROM public.get_nomina_by_cost_center(mo.mes) n
              WHERE n.cost_center_code='ENTRETELAS'),0) + (SELECT r FROM rent_ent) AS fab_ent
  FROM months mo WHERE mo.mes >= '2026-01'
),
base AS (
  SELECT mo.mes,
    COALESCE(m.m,0)::numeric AS met, COALESCE(i.m,0)::numeric AS insp_m, COALESCE(v.m_equiv,0)::numeric AS vend_equiv,
    COALESCE(g.fab,0)::numeric AS fab, COALESCE(g.op,0)::numeric AS op,
    COALESCE(i.kg,0)::numeric AS kg_insp, COALESCE(v.kg,0)::numeric AS kg_vend,
    COALESCE(i.m_ent,0)::numeric AS insp_m_ent, COALESCE(i.kg_ent_carda,0)::numeric AS kg_insp_ent_carda,
    COALESCE(e.fab_ent,0)::numeric AS fab_ent
  FROM months mo
  LEFT JOIN metros m ON m.mes=mo.mes LEFT JOIN insp i ON i.mes=mo.mes
  LEFT JOIN ventas v ON v.mes=mo.mes LEFT JOIN gastos g ON g.mes=mo.mes
  LEFT JOIN ent e ON e.mes=mo.mes
)
SELECT b.mes, b.met, b.insp_m, b.vend_equiv, b.fab, b.op,
  CASE WHEN b.met>0 THEN ROUND(b.fab/b.met,4) END,
  CASE WHEN b.met>0 THEN ROUND(b.op/b.met,4) END,
  CASE WHEN b.met>0 THEN ROUND((b.fab+b.op)/b.met,4) END,
  CASE WHEN b.insp_m>0 THEN ROUND(b.fab/b.insp_m,4) END,
  CASE WHEN b.insp_m>0 THEN ROUND(b.op/b.insp_m,4) END,
  CASE WHEN b.insp_m>0 THEN ROUND((b.fab+b.op)/b.insp_m,4) END,
  CASE WHEN b.vend_equiv>0 THEN ROUND(b.op/b.vend_equiv,4) END,
  b.kg_insp, b.kg_vend,
  CASE WHEN b.kg_insp>0 THEN ROUND(b.fab/b.kg_insp,4) END,
  CASE WHEN b.kg_vend>0 THEN ROUND(b.op/b.kg_vend,4) END,
  CASE WHEN b.kg_insp>0 AND b.kg_vend>0 THEN ROUND(b.fab/b.kg_insp + b.op/b.kg_vend,4) END,
  ROUND(
    (SUM(CASE WHEN b.fab>0 AND b.kg_insp>0 THEN b.fab ELSE 0 END) OVER w)
    / NULLIF(SUM(CASE WHEN b.fab>0 AND b.kg_insp>0 THEN b.kg_insp ELSE 0 END) OVER w, 0), 4),
  ROUND(
    (SUM(CASE WHEN b.op>0 AND b.kg_vend>0 THEN b.op ELSE 0 END) OVER w)
    / NULLIF(SUM(CASE WHEN b.op>0 AND b.kg_vend>0 THEN b.kg_vend ELSE 0 END) OVER w, 0), 4),
  ROUND(
    (SUM(CASE WHEN b.fab>0 AND b.kg_insp>0 THEN b.fab ELSE 0 END) OVER w)
    / NULLIF(SUM(CASE WHEN b.fab>0 AND b.kg_insp>0 THEN b.kg_insp ELSE 0 END) OVER w, 0)
    + (SUM(CASE WHEN b.op>0 AND b.kg_vend>0 THEN b.op ELSE 0 END) OVER w)
    / NULLIF(SUM(CASE WHEN b.op>0 AND b.kg_vend>0 THEN b.kg_vend ELSE 0 END) OVER w, 0), 4),
  ROUND( (SELECT ws FROM cfg) *
    (SUM(CASE WHEN (b.fab-b.fab_ent)>0 AND (b.kg_insp-b.kg_insp_ent_carda)>0 THEN (b.fab-b.fab_ent) ELSE 0 END) OVER w)
    / NULLIF(SUM(CASE WHEN (b.fab-b.fab_ent)>0 AND (b.kg_insp-b.kg_insp_ent_carda)>0 THEN (b.kg_insp-b.kg_insp_ent_carda) ELSE 0 END) OVER w, 0), 4),
  ROUND( (1 - (SELECT ws FROM cfg)) *
    (SUM(CASE WHEN (b.fab-b.fab_ent)>0 AND (b.insp_m-b.insp_m_ent)>0 THEN (b.fab-b.fab_ent) ELSE 0 END) OVER w)
    / NULLIF(SUM(CASE WHEN (b.fab-b.fab_ent)>0 AND (b.insp_m-b.insp_m_ent)>0 THEN (b.insp_m-b.insp_m_ent) ELSE 0 END) OVER w, 0), 4)
FROM base b
WINDOW w AS (ORDER BY b.mes ROWS BETWEEN 11 PRECEDING AND CURRENT ROW)
ORDER BY b.mes;
$function$;
