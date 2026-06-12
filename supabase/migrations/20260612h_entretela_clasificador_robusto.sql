-- 2026-06-12h: clasificador robusto de entretela tejida vs carda.
--
-- Auditoria de las entretelas "ambiguas" (nombre sin 'tejido circular' ni 'no
-- tejida') revelo un hueco: las resin-coded de la categoria Puntos (p.ej.
-- WM4032AZ160 "ENTRETELA FUSIONABLE") caian a carda y se sub-costeaban (les
-- faltaba tejido+tintoreria). Regla nueva:
--   tejida = entretela, name NOT ~ 'no tejid', y (name ~ 'tejido circular' |
--            'tejida' | categoria ~ 'Puntos')
--   carda  = entretela y NO tejida
-- Captura WM4032AZ160 y cualquier resin de Puntos presente/futura. Las de
-- nombre 'no tejido/tejida' (carda real) y los perfoquim/termofijado sin base
-- tejida siguen en carda. Se aplica IDENTICO en get_full_cost_reconstruction
-- (ruteo de fab por producto) y get_cost_factors_monthly (denominador de peso:
-- solo carda sale). Cache v23->v24.
--
-- NOTA: los cuerpos completos de ambas funciones se aplicaron via apply_migration
-- (identicos a 20260612g/f salvo el predicado de clasificacion). Esta migracion
-- documenta el cambio; el predicado vigente es el de arriba.

CREATE OR REPLACE FUNCTION public.get_full_cost_reconstruction(p_period text)
 RETURNS TABLE(odoo_product_id integer, product_ref text, product_name text, uom text, qty_sold numeric, revenue_mxn numeric, costo_primo_unit_mxn numeric, factor_fab_unit_mxn numeric, factor_op_unit_mxn numeric, costo_total_unit_mxn numeric, costo_primo_total_mxn numeric, gastos_fab_total_mxn numeric, gastos_op_total_mxn numeric, costo_total_mxn numeric, pct_mp numeric, pct_fab numeric, pct_op numeric, margin_full_pct numeric, mp_source text, costo_primo_avg_unit_mxn numeric, costo_primo_avg_total_mxn numeric, kg_per_unit numeric, m_per_kg numeric)
 LANGUAGE sql STABLE AS $function$
WITH factors AS (SELECT factor_fab_peso_kg_smooth AS fp, factor_fab_largo_m_smooth AS fl FROM public.get_cost_factors_monthly(48) WHERE mes = p_period LIMIT 1),
fent AS (SELECT factor_ent_m_smooth AS fe FROM public.get_entretela_fab_factor_monthly(48) WHERE mes = p_period LIMIT 1),
op_pct AS (
  SELECT SUM(gp.op_pool)/NULLIF(SUM(rv.rev),0) AS pct
  FROM (SELECT period AS mes, SUM(balance) FILTER (WHERE account_code LIKE '6%') AS op_pool FROM public.odoo_account_balances WHERE period <= p_period AND period > to_char(((p_period||'-01')::date - interval '12 months'),'YYYY-MM') GROUP BY 1) gp
  JOIN (SELECT to_char(invoice_date,'YYYY-MM') AS mes, SUM(price_subtotal_mxn) AS rev FROM public.odoo_invoice_lines WHERE move_type='out_invoice' AND invoice_date < (((p_period||'-01')::date)+interval '1 month') AND invoice_date >= (((p_period||'-01')::date)-interval '11 months') GROUP BY 1) rv ON rv.mes=gp.mes
  WHERE gp.op_pool>0 AND rv.rev>0),
d_from AS (SELECT (p_period || '-01')::date AS df),
all_lines AS (SELECT il.odoo_move_id, il.odoo_product_id, il.quantity, il.price_subtotal_mxn FROM public.odoo_invoice_lines il, d_from WHERE il.move_type='out_invoice' AND il.invoice_date >= d_from.df AND il.invoice_date < (d_from.df + interval '1 month') AND il.odoo_product_id IS NOT NULL),
rev AS (SELECT odoo_product_id::int AS pid, SUM(COALESCE(price_subtotal_mxn,0))::numeric AS revenue FROM all_lines GROUP BY 1),
qty AS (SELECT odoo_product_id::int AS pid, SUM(quantity)::numeric AS qty_sold FROM (SELECT DISTINCT ON (odoo_move_id, odoo_product_id, quantity) odoo_move_id, odoo_product_id, quantity FROM all_lines) d GROUP BY 1),
base AS (
  SELECT COALESCE(r.pid, q.pid) AS pid, cp.internal_ref AS product_ref, cp.display_name AS product_name, op.uom, COALESCE(q.qty_sold,0) AS qty_sold, COALESCE(r.revenue,0) AS revenue,
    public.get_bom_mp_cost_lastcost(COALESCE(r.pid,q.pid)) AS primo_unit, public.get_bom_raw_material_cost_per_unit(COALESCE(r.pid,q.pid)) AS primo_avg_unit,
    COALESCE(kpu.kg_per_unit,0) AS conv, COALESCE(puc.m_per_kg,0) AS m_per_kg, (cp.internal_ref ~ ' I$') AS is_import,
    (op.category ILIKE '%Entretela%' AND op.category NOT ILIKE '%Importaci%') AS is_entretela,
    (op.category ILIKE '%Entretela%' AND op.category NOT ILIKE '%Importaci%' AND op.name NOT ILIKE '%no tejid%' AND (op.name ILIKE '%tejido circular%' OR op.name ILIKE '%tejida%' OR op.category ILIKE '%Puntos%')) AS is_tejida_ent,
    (cp.is_byproduct OR cp.internal_ref ~* '^\s*(SALDO|DESPERDICIO)') AS is_byproduct,
    CASE WHEN cp.is_byproduct OR cp.internal_ref ~* '^\s*(SALDO|DESPERDICIO)' THEN 'subproducto_cero' WHEN cp.internal_ref ~ ' I$' THEN 'importado_ultima_compra' WHEN EXISTS (SELECT 1 FROM public.mv_primary_bom pb WHERE pb.odoo_product_id=COALESCE(r.pid,q.pid)) THEN 'bom_recursivo' WHEN EXISTS (SELECT 1 FROM public.odoo_order_lines ol WHERE ol.order_type='purchase' AND ol.odoo_product_id=COALESCE(r.pid,q.pid) AND ol.qty>0 AND ol.subtotal_mxn>0) THEN 'ultima_compra' ELSE 'avg_cost_fallback' END AS mp_source
  FROM rev r FULL OUTER JOIN qty q ON q.pid=r.pid
  LEFT JOIN public.canonical_products cp ON cp.odoo_product_id=COALESCE(r.pid,q.pid)
  LEFT JOIN public.odoo_products op ON op.odoo_product_id=COALESCE(r.pid,q.pid)
  LEFT JOIN public.product_kg_per_unit kpu ON kpu.odoo_product_id=COALESCE(r.pid,q.pid)
  LEFT JOIN public.product_uom_conversion puc ON puc.odoo_product_id=COALESCE(r.pid,q.pid)),
calc AS (
  SELECT b.*,
    CASE WHEN b.is_import THEN 0
         WHEN b.is_tejida_ent AND (SELECT fe FROM fent) IS NOT NULL AND b.uom='m' THEN b.conv*COALESCE((SELECT fp FROM factors),0)+COALESCE((SELECT fe FROM fent),0)
         WHEN b.is_tejida_ent AND (SELECT fe FROM fent) IS NOT NULL AND b.uom='kg' THEN COALESCE((SELECT fp FROM factors),0)+b.m_per_kg*COALESCE((SELECT fe FROM fent),0)
         WHEN b.is_entretela AND (SELECT fe FROM fent) IS NOT NULL AND b.uom='m' THEN COALESCE((SELECT fe FROM fent),0)
         WHEN b.is_entretela AND (SELECT fe FROM fent) IS NOT NULL AND b.uom='kg' THEN COALESCE((SELECT fe FROM fent),0)*b.m_per_kg
         WHEN b.uom='m' THEN b.conv*COALESCE((SELECT fp FROM factors),0)+COALESCE((SELECT fl FROM factors),0)
         WHEN b.uom='kg' THEN COALESCE((SELECT fp FROM factors),0)+b.m_per_kg*COALESCE((SELECT fl FROM factors),0)
         ELSE 0 END AS fab_unit,
    CASE WHEN b.qty_sold>0 THEN COALESCE((SELECT pct FROM op_pct),0)*b.revenue/b.qty_sold ELSE 0 END AS op_unit
  FROM base b)
SELECT c.pid, c.product_ref, c.product_name, c.uom, c.qty_sold, ROUND(c.revenue,2), ROUND(c.primo_unit,4), ROUND(c.fab_unit,4), ROUND(c.op_unit,4), ROUND(c.primo_unit+c.fab_unit+c.op_unit,4), ROUND(c.qty_sold*c.primo_unit,2), ROUND(c.qty_sold*c.fab_unit,2), ROUND(c.qty_sold*c.op_unit,2), ROUND(c.qty_sold*(c.primo_unit+c.fab_unit+c.op_unit),2),
  CASE WHEN (c.primo_unit+c.fab_unit+c.op_unit)>0 THEN ROUND(c.primo_unit/(c.primo_unit+c.fab_unit+c.op_unit)*100,1) END,
  CASE WHEN (c.primo_unit+c.fab_unit+c.op_unit)>0 THEN ROUND(c.fab_unit/(c.primo_unit+c.fab_unit+c.op_unit)*100,1) END,
  CASE WHEN (c.primo_unit+c.fab_unit+c.op_unit)>0 THEN ROUND(c.op_unit/(c.primo_unit+c.fab_unit+c.op_unit)*100,1) END,
  CASE WHEN c.revenue>0 THEN ROUND((c.revenue-c.qty_sold*(c.primo_unit+c.fab_unit+c.op_unit))/c.revenue*100,1) END,
  c.mp_source, ROUND(c.primo_avg_unit,4), ROUND(c.qty_sold*c.primo_avg_unit,2), ROUND(c.conv,5), ROUND(c.m_per_kg,5)
FROM calc c WHERE (c.qty_sold<>0 OR c.revenue<>0) AND NOT c.is_byproduct;
$function$;

CREATE OR REPLACE FUNCTION public.get_cost_factors_monthly(p_months_back integer DEFAULT 12)
 RETURNS TABLE(mes text, metros_referencia numeric, metros_inspeccion numeric, metros_vendidos_equiv numeric, gastos_fabricacion_mxn numeric, gastos_operacion_mxn numeric, factor_fab_x_metro numeric, factor_op_x_metro numeric, factor_total_x_metro numeric, factor_fab_insp numeric, factor_op_insp numeric, factor_total_insp numeric, factor_op_vendido numeric, kg_inspeccion numeric, kg_vendidos numeric, factor_fab_kg numeric, factor_op_kg numeric, factor_total_kg numeric, factor_fab_kg_smooth numeric, factor_op_kg_smooth numeric, factor_total_kg_smooth numeric, factor_fab_peso_kg_smooth numeric, factor_fab_largo_m_smooth numeric)
 LANGUAGE sql STABLE AS $function$
WITH cfg AS (SELECT COALESCE((SELECT value FROM public.costing_config WHERE key='fab_weight_share'),0.47) AS ws),
rent_ent AS (SELECT COALESCE(sum(monthly_amount_mxn*allocation_pct/100),0) AS r FROM public.rent_lot_assignment WHERE cost_center_code='ENTRETELAS'),
months AS (SELECT to_char(gs,'YYYY-MM') AS mes FROM generate_series(date_trunc('month',CURRENT_DATE)-(p_months_back-1)*interval '1 month', date_trunc('month',CURRENT_DATE), interval '1 month') gs),
metros AS (SELECT to_char(date_finished,'YYYY-MM') AS mes, SUM(qty_produced) AS m FROM public.odoo_manufacturing WHERE (name LIKE 'TL/OP-ACA%' OR name LIKE 'TL/OP-V10%') AND state='done' AND qty_produced>0 GROUP BY 1),
insp AS (
  SELECT to_char(csm.date,'YYYY-MM') AS mes, SUM(csm.quantity) AS m,
    SUM(csm.quantity*kpu.kg_per_unit) FILTER (WHERE cp.internal_ref !~ ' I$' OR cp.internal_ref IS NULL) AS kg,
    SUM(csm.quantity) FILTER (WHERE op.category ILIKE '%Entretela%' AND op.category NOT ILIKE '%Importaci%') AS m_ent,
    SUM(csm.quantity*kpu.kg_per_unit) FILTER (WHERE (cp.internal_ref !~ ' I$' OR cp.internal_ref IS NULL) AND op.category ILIKE '%Entretela%' AND op.category NOT ILIKE '%Importaci%' AND (op.name ILIKE '%no tejid%' OR NOT (op.name ILIKE '%tejido circular%' OR op.name ILIKE '%tejida%' OR op.category ILIKE '%Puntos%'))) AS kg_ent_carda
  FROM public.canonical_stock_moves csm
  LEFT JOIN public.odoo_products op ON op.odoo_product_id=csm.odoo_product_id
  LEFT JOIN public.canonical_products cp ON cp.odoo_product_id=csm.odoo_product_id
  LEFT JOIN public.product_kg_per_unit kpu ON kpu.odoo_product_id=csm.odoo_product_id
  WHERE csm.reference LIKE 'TL/INSP%' AND csm.state='done' AND csm.date >= date_trunc('month',CURRENT_DATE)-p_months_back*interval '1 month' AND csm.quantity>0 AND (op.uom='m' OR op.uom IS NULL)
  GROUP BY 1),
ventas AS (
  SELECT to_char(il.invoice_date,'YYYY-MM') AS mes,
    SUM(CASE WHEN op.uom='m' THEN il.quantity WHEN op.uom='kg' THEN il.quantity*COALESCE(puc.m_per_kg,0) ELSE 0 END) AS m_equiv,
    SUM(il.quantity*COALESCE(kpu.kg_per_unit,0)) AS kg
  FROM (SELECT DISTINCT ON (odoo_move_id, odoo_product_id, quantity) odoo_move_id, odoo_product_id, quantity, invoice_date FROM public.odoo_invoice_lines WHERE move_type='out_invoice' AND odoo_product_id IS NOT NULL) il
  LEFT JOIN public.odoo_products op ON op.odoo_product_id=il.odoo_product_id
  LEFT JOIN public.product_uom_conversion puc ON puc.odoo_product_id=il.odoo_product_id
  LEFT JOIN public.product_kg_per_unit kpu ON kpu.odoo_product_id=il.odoo_product_id
  GROUP BY 1),
gastos AS (SELECT period AS mes, SUM(balance) FILTER (WHERE account_code LIKE '501.06%' OR account_code LIKE '504.01%' OR account_code ~ '^504\.(0[89]|1[0-9]|2[0-3])') AS fab, SUM(balance) FILTER (WHERE account_code LIKE '6%') AS op FROM public.odoo_account_balances GROUP BY 1),
ent AS (SELECT mo.mes, COALESCE((SELECT sum(n.total_nomina_mxn) FROM public.get_nomina_by_cost_center(mo.mes) n WHERE n.cost_center_code='ENTRETELAS'),0)+(SELECT r FROM rent_ent) AS fab_ent FROM months mo WHERE mo.mes >= '2026-01'),
base AS (
  SELECT mo.mes, COALESCE(m.m,0)::numeric AS met, COALESCE(i.m,0)::numeric AS insp_m, COALESCE(v.m_equiv,0)::numeric AS vend_equiv, COALESCE(g.fab,0)::numeric AS fab, COALESCE(g.op,0)::numeric AS op, COALESCE(i.kg,0)::numeric AS kg_insp, COALESCE(v.kg,0)::numeric AS kg_vend, COALESCE(i.m_ent,0)::numeric AS insp_m_ent, COALESCE(i.kg_ent_carda,0)::numeric AS kg_insp_ent_carda, COALESCE(e.fab_ent,0)::numeric AS fab_ent
  FROM months mo LEFT JOIN metros m ON m.mes=mo.mes LEFT JOIN insp i ON i.mes=mo.mes LEFT JOIN ventas v ON v.mes=mo.mes LEFT JOIN gastos g ON g.mes=mo.mes LEFT JOIN ent e ON e.mes=mo.mes)
SELECT b.mes, b.met, b.insp_m, b.vend_equiv, b.fab, b.op,
  CASE WHEN b.met>0 THEN ROUND(b.fab/b.met,4) END, CASE WHEN b.met>0 THEN ROUND(b.op/b.met,4) END, CASE WHEN b.met>0 THEN ROUND((b.fab+b.op)/b.met,4) END,
  CASE WHEN b.insp_m>0 THEN ROUND(b.fab/b.insp_m,4) END, CASE WHEN b.insp_m>0 THEN ROUND(b.op/b.insp_m,4) END, CASE WHEN b.insp_m>0 THEN ROUND((b.fab+b.op)/b.insp_m,4) END,
  CASE WHEN b.vend_equiv>0 THEN ROUND(b.op/b.vend_equiv,4) END, b.kg_insp, b.kg_vend,
  CASE WHEN b.kg_insp>0 THEN ROUND(b.fab/b.kg_insp,4) END, CASE WHEN b.kg_vend>0 THEN ROUND(b.op/b.kg_vend,4) END, CASE WHEN b.kg_insp>0 AND b.kg_vend>0 THEN ROUND(b.fab/b.kg_insp+b.op/b.kg_vend,4) END,
  ROUND((SUM(CASE WHEN b.fab>0 AND b.kg_insp>0 THEN b.fab ELSE 0 END) OVER w)/NULLIF(SUM(CASE WHEN b.fab>0 AND b.kg_insp>0 THEN b.kg_insp ELSE 0 END) OVER w,0),4),
  ROUND((SUM(CASE WHEN b.op>0 AND b.kg_vend>0 THEN b.op ELSE 0 END) OVER w)/NULLIF(SUM(CASE WHEN b.op>0 AND b.kg_vend>0 THEN b.kg_vend ELSE 0 END) OVER w,0),4),
  ROUND((SUM(CASE WHEN b.fab>0 AND b.kg_insp>0 THEN b.fab ELSE 0 END) OVER w)/NULLIF(SUM(CASE WHEN b.fab>0 AND b.kg_insp>0 THEN b.kg_insp ELSE 0 END) OVER w,0)+(SUM(CASE WHEN b.op>0 AND b.kg_vend>0 THEN b.op ELSE 0 END) OVER w)/NULLIF(SUM(CASE WHEN b.op>0 AND b.kg_vend>0 THEN b.kg_vend ELSE 0 END) OVER w,0),4),
  ROUND((SELECT ws FROM cfg)*(SUM(CASE WHEN (b.fab-b.fab_ent)>0 AND (b.kg_insp-b.kg_insp_ent_carda)>0 THEN (b.fab-b.fab_ent) ELSE 0 END) OVER w)/NULLIF(SUM(CASE WHEN (b.fab-b.fab_ent)>0 AND (b.kg_insp-b.kg_insp_ent_carda)>0 THEN (b.kg_insp-b.kg_insp_ent_carda) ELSE 0 END) OVER w,0),4),
  ROUND((1-(SELECT ws FROM cfg))*(SUM(CASE WHEN (b.fab-b.fab_ent)>0 AND (b.insp_m-b.insp_m_ent)>0 THEN (b.fab-b.fab_ent) ELSE 0 END) OVER w)/NULLIF(SUM(CASE WHEN (b.fab-b.fab_ent)>0 AND (b.insp_m-b.insp_m_ent)>0 THEN (b.insp_m-b.insp_m_ent) ELSE 0 END) OVER w,0),4)
FROM base b WINDOW w AS (ORDER BY b.mes ROWS BETWEEN 11 PRECEDING AND CURRENT ROW) ORDER BY b.mes;
$function$;
