-- Cutover del cost model a public.costo_bucket() (ver 20260623_costo_bucket_helper.sql).
--
-- Las 5 funciones que clasificaban producto→proceso con patrones de categoría/nombre inline
-- ahora llaman al helper único. Esto desacopla el costeo de los nombres de categoría de Odoo:
-- cuando la reestructura PT (Tejido Circular/No Tejido × Con/Sin resina, dibujo→WIP) se importe
-- y sincronice, el costeo seguirá clasificando bien sin tocar código.
--
-- VALIDADO byte-neutral contra snapshots previos al swap (mismo periodo/datos):
--   get_full_cost_reconstruction : 0 diffs en 7 periodos (2025-06..2026-05), Σ|Δ| = $0.0000
--   get_cost_factors_monthly     : 0 diffs en 48 meses (todas las columnas de factor)
--   get_entretela_fab_factor_monthly : 0 diffs en 48 meses
--   get_cost_audit_by_family     : 0 diffs en 3 periodos
--   refresh_product_cost_catalog : 0 diffs de clasificación (familia) en 1,354 productos
--                                  (los Δ numéricos observados eran drift de datos entre el
--                                   último refresh y este, mismo periodo 2026-06)
--
-- Nota: el helper es agnóstico al import; el import (' I$' → fab=0) se sigue manejando aparte
-- en cada función (is_import), por eso la entretela importada que sí se manufactura permanece
-- en el denominador del factor entretela (neutral).

-- 1) get_cost_factors_monthly --------------------------------------------------
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
         SUM(csm.quantity) FILTER (WHERE public.costo_bucket(op.category, op.name, cp.internal_ref) IN ('ent_tejida','ent_carda')) AS m_ent,
         SUM(csm.quantity * kpu.kg_per_unit) FILTER (
            WHERE (cp.internal_ref !~ ' I$' OR cp.internal_ref IS NULL)
              AND public.costo_bucket(op.category, op.name, cp.internal_ref) = 'ent_carda'
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
      OR account_code ~ '^504\.(0[89]|1[0-9]|2[0-3])' OR account_code LIKE '701.11%') AS fab,
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
  ROUND((SUM(CASE WHEN b.fab>0 AND b.kg_insp>0 THEN b.fab ELSE 0 END) OVER w)
    / NULLIF(SUM(CASE WHEN b.fab>0 AND b.kg_insp>0 THEN b.kg_insp ELSE 0 END) OVER w, 0), 4),
  ROUND((SUM(CASE WHEN b.op>0 AND b.kg_vend>0 THEN b.op ELSE 0 END) OVER w)
    / NULLIF(SUM(CASE WHEN b.op>0 AND b.kg_vend>0 THEN b.kg_vend ELSE 0 END) OVER w, 0), 4),
  ROUND((SUM(CASE WHEN b.fab>0 AND b.kg_insp>0 THEN b.fab ELSE 0 END) OVER w)
    / NULLIF(SUM(CASE WHEN b.fab>0 AND b.kg_insp>0 THEN b.kg_insp ELSE 0 END) OVER w, 0)
    + (SUM(CASE WHEN b.op>0 AND b.kg_vend>0 THEN b.op ELSE 0 END) OVER w)
    / NULLIF(SUM(CASE WHEN b.op>0 AND b.kg_vend>0 THEN b.kg_vend ELSE 0 END) OVER w, 0), 4),
  ROUND((SELECT ws FROM cfg) *
    (SUM(CASE WHEN (b.fab-b.fab_ent)>0 AND (b.kg_insp-b.kg_insp_ent_carda)>0 THEN (b.fab-b.fab_ent) ELSE 0 END) OVER w)
    / NULLIF(SUM(CASE WHEN (b.fab-b.fab_ent)>0 AND (b.kg_insp-b.kg_insp_ent_carda)>0 THEN (b.kg_insp-b.kg_insp_ent_carda) ELSE 0 END) OVER w, 0), 4),
  ROUND((1 - (SELECT ws FROM cfg)) *
    (SUM(CASE WHEN (b.fab-b.fab_ent)>0 AND (b.insp_m-b.insp_m_ent)>0 THEN (b.fab-b.fab_ent) ELSE 0 END) OVER w)
    / NULLIF(SUM(CASE WHEN (b.fab-b.fab_ent)>0 AND (b.insp_m-b.insp_m_ent)>0 THEN (b.insp_m-b.insp_m_ent) ELSE 0 END) OVER w, 0), 4)
FROM base b
WINDOW w AS (ORDER BY b.mes ROWS BETWEEN 11 PRECEDING AND CURRENT ROW)
ORDER BY b.mes;
$function$;

-- 2) get_entretela_fab_factor_monthly -----------------------------------------
CREATE OR REPLACE FUNCTION public.get_entretela_fab_factor_monthly(p_months_back integer DEFAULT 12)
 RETURNS TABLE(mes text, costo_ent_mxn numeric, metros_ent numeric, factor_ent_m numeric, factor_ent_m_smooth numeric)
 LANGUAGE sql STABLE
AS $function$
WITH months AS (
  SELECT to_char(gs,'YYYY-MM') AS mes
  FROM generate_series(date_trunc('month',CURRENT_DATE)-(p_months_back-1)*interval '1 month',
       date_trunc('month',CURRENT_DATE), interval '1 month') gs
),
rent AS (SELECT COALESCE(sum(monthly_amount_mxn*allocation_pct/100),0) AS r FROM public.rent_lot_assignment WHERE cost_center_code='ENTRETELAS'),
extra AS (SELECT COALESCE((SELECT value FROM public.costing_config WHERE key='entretela_overhead_extra_mxn'),0) AS e),
prod AS (
  SELECT to_char(m.date_finished,'YYYY-MM') AS mes, SUM(m.qty_produced) AS metros
  FROM public.odoo_manufacturing m
  JOIN public.odoo_products op ON op.odoo_product_id=m.odoo_product_id
  LEFT JOIN public.canonical_products cp ON cp.odoo_product_id=m.odoo_product_id
  WHERE m.state='done' AND m.qty_produced>0 AND op.uom='m'
    AND public.costo_bucket(op.category, op.name, cp.internal_ref) IN ('ent_tejida','ent_carda')
  GROUP BY 1
),
nom AS (
  SELECT pr.mes,
    COALESCE((SELECT sum(n.total_nomina_mxn) FROM public.get_nomina_by_cost_center(pr.mes) n
              WHERE n.cost_center_code='ENTRETELAS'),0) AS nomina
  FROM (SELECT DISTINCT mes FROM prod) pr
),
base AS (
  SELECT mo.mes,
    COALESCE(n.nomina,0) + (SELECT r FROM rent) + (SELECT e FROM extra) AS costo,
    COALESCE(p.metros,0) AS metros
  FROM months mo LEFT JOIN prod p ON p.mes=mo.mes LEFT JOIN nom n ON n.mes=mo.mes
)
SELECT b.mes, ROUND(b.costo,2), ROUND(b.metros,0),
  CASE WHEN b.metros>0 THEN ROUND(b.costo/b.metros,4) END,
  ROUND((SUM(CASE WHEN b.metros>0 THEN b.costo ELSE 0 END) OVER w)
       / NULLIF(SUM(CASE WHEN b.metros>0 THEN b.metros ELSE 0 END) OVER w,0), 4)
FROM base b
WINDOW w AS (ORDER BY b.mes ROWS BETWEEN 11 PRECEDING AND CURRENT ROW)
ORDER BY b.mes;
$function$;

-- 3) get_full_cost_reconstruction ---------------------------------------------
CREATE OR REPLACE FUNCTION public.get_full_cost_reconstruction(p_period text)
 RETURNS TABLE(odoo_product_id integer, product_ref text, product_name text, uom text, qty_sold numeric, revenue_mxn numeric, costo_primo_unit_mxn numeric, factor_fab_unit_mxn numeric, factor_op_unit_mxn numeric, costo_total_unit_mxn numeric, costo_primo_total_mxn numeric, gastos_fab_total_mxn numeric, gastos_op_total_mxn numeric, costo_total_mxn numeric, pct_mp numeric, pct_fab numeric, pct_op numeric, margin_full_pct numeric, mp_source text, costo_primo_avg_unit_mxn numeric, costo_primo_avg_total_mxn numeric, kg_per_unit numeric, m_per_kg numeric)
 LANGUAGE sql STABLE
AS $function$
WITH factors AS (
  SELECT factor_fab_peso_kg_smooth AS fp, factor_fab_largo_m_smooth AS fl
  FROM public.get_cost_factors_monthly(48) WHERE mes = p_period LIMIT 1
),
fent AS (SELECT factor_ent_m_smooth AS fe FROM public.get_entretela_fab_factor_monthly(48) WHERE mes = p_period LIMIT 1),
op_pct AS (
  SELECT SUM(gp.op_pool) / NULLIF(SUM(rv.rev),0) AS pct
  FROM (SELECT period AS mes, SUM(balance) FILTER (WHERE account_code LIKE '6%') AS op_pool
        FROM public.odoo_account_balances
        WHERE period <= p_period AND period > to_char(((p_period||'-01')::date - interval '12 months'),'YYYY-MM') GROUP BY 1) gp
  JOIN (SELECT to_char(invoice_date,'YYYY-MM') AS mes, SUM(price_subtotal_mxn) AS rev
        FROM public.odoo_invoice_lines
        WHERE move_type='out_invoice' AND invoice_date < (((p_period||'-01')::date) + interval '1 month')
          AND invoice_date >= (((p_period||'-01')::date) - interval '11 months') GROUP BY 1) rv ON rv.mes = gp.mes
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
qty AS (SELECT odoo_product_id::int AS pid, SUM(quantity)::numeric AS qty_sold
        FROM (SELECT DISTINCT ON (odoo_move_id, odoo_product_id, quantity) odoo_move_id, odoo_product_id, quantity FROM all_lines) d GROUP BY 1),
base AS (
  SELECT COALESCE(r.pid, q.pid) AS pid, cp.internal_ref AS product_ref, cp.display_name AS product_name,
    op.uom, COALESCE(q.qty_sold, 0) AS qty_sold, COALESCE(r.revenue, 0) AS revenue,
    public.get_bom_mp_cost_lastcost(COALESCE(r.pid, q.pid)) AS primo_unit,
    public.get_bom_raw_material_cost_per_unit(COALESCE(r.pid, q.pid)) AS primo_avg_unit,
    COALESCE(kpu.kg_per_unit, 0) AS conv, COALESCE(puc.m_per_kg, 0) AS m_per_kg,
    (cp.internal_ref ~ ' I$') AS is_import,
    (public.costo_bucket(op.category, op.name, cp.internal_ref) IN ('ent_tejida','ent_carda')) AS is_entretela,
    (public.costo_bucket(op.category, op.name, cp.internal_ref) = 'ent_tejida') AS is_tejida_ent,
    (cp.is_byproduct OR cp.internal_ref ~* '^\s*(SALDO|DESPERDICIO)') AS is_byproduct,
    CASE
      WHEN cp.is_byproduct OR cp.internal_ref ~* '^\s*(SALDO|DESPERDICIO)' THEN 'subproducto_cero'
      WHEN cp.internal_ref ~ ' I$' THEN 'importado_ultima_compra'
      WHEN EXISTS (SELECT 1 FROM public.mv_primary_bom pb WHERE pb.odoo_product_id = COALESCE(r.pid,q.pid)) THEN 'bom_recursivo'
      WHEN EXISTS (SELECT 1 FROM public.odoo_order_lines ol WHERE ol.order_type='purchase' AND ol.odoo_product_id=COALESCE(r.pid,q.pid) AND ol.qty>0 AND ol.subtotal_mxn>0) THEN 'ultima_compra'
      ELSE 'avg_cost_fallback' END AS mp_source
  FROM rev r FULL OUTER JOIN qty q ON q.pid = r.pid
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
SELECT c.pid, c.product_ref, c.product_name, c.uom, c.qty_sold, ROUND(c.revenue, 2),
  ROUND(c.primo_unit, 4), ROUND(c.fab_unit, 4), ROUND(c.op_unit, 4),
  ROUND(c.primo_unit + c.fab_unit + c.op_unit, 4),
  ROUND(c.qty_sold * c.primo_unit, 2), ROUND(c.qty_sold * c.fab_unit, 2), ROUND(c.qty_sold * c.op_unit, 2),
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

-- 4) get_cost_audit_by_family -------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_cost_audit_by_family(p_period text)
 RETURNS TABLE(familia text, n integer, mp_mxn numeric, fab_mxn numeric, op_mxn numeric, revenue_mxn numeric)
 LANGUAGE sql STABLE
AS $function$
  SELECT
    CASE
      WHEN op.category ILIKE '%Entretela%' AND op.category ILIKE '%Importaci%' THEN 'Entretela importada'
      WHEN public.costo_bucket(op.category, op.name, r.product_ref) = 'ent_tejida' THEN 'Entretela tejida'
      WHEN public.costo_bucket(op.category, op.name, r.product_ref) = 'ent_carda' THEN 'Entretela carda'
      WHEN r.product_ref ~ ' I$' THEN 'Importado (tela)'
      WHEN op.uom='kg' THEN 'Tela por kg'
      WHEN op.category ILIKE '%Tac-%' OR op.category ILIKE '%Acabado%'
           OR (op.category ILIKE '%Tejido Circular%' AND op.category ILIKE '%resina%') THEN 'Tela acabado (m)'
      ELSE 'Otro'
    END AS familia,
    count(*)::int, COALESCE(sum(r.costo_primo_total_mxn),0)::numeric, COALESCE(sum(r.gastos_fab_total_mxn),0)::numeric,
    COALESCE(sum(r.gastos_op_total_mxn),0)::numeric, COALESCE(sum(r.revenue_mxn),0)::numeric
  FROM public.get_full_cost_reconstruction(p_period) r
  JOIN public.odoo_products op ON op.odoo_product_id = r.odoo_product_id
  GROUP BY 1 ORDER BY 4 DESC;
$function$;

-- 5) refresh_product_cost_catalog ---------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_product_cost_catalog(p_period text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_period text; v_fp numeric; v_fl numeric; v_fent numeric; v_fkg numeric; v_oppct numeric; v_count integer;
BEGIN
  v_period := COALESCE(p_period, (SELECT max(mes) FROM public.get_cost_factors_monthly(6) WHERE gastos_fabricacion_mxn > 0));
  SELECT factor_fab_peso_kg_smooth, factor_fab_largo_m_smooth INTO v_fp, v_fl FROM public.get_cost_factors_monthly(48) WHERE mes = v_period;
  SELECT factor_ent_m_smooth INTO v_fent FROM public.get_entretela_fab_factor_monthly(48) WHERE mes = v_period;
  SELECT SUM(e.energia)/NULLIF(SUM(f.kg),0) INTO v_fkg
  FROM (SELECT ab.period mes, SUM(ab.balance) energia FROM public.odoo_account_balances ab
        WHERE ab.period <= v_period AND ab.period > to_char(((v_period||'-01')::date - interval '12 months'),'YYYY-MM')
          AND EXISTS (SELECT 1 FROM public.costing_variable_accounts va WHERE ab.account_code LIKE va.account_pattern)
        GROUP BY 1 HAVING SUM(ab.balance) > 0) e
  JOIN (SELECT mes, kg_inspeccion kg FROM public.get_cost_factors_monthly(48)) f ON f.mes = e.mes AND f.kg > 0;
  SELECT SUM(gp.op_pool)/NULLIF(SUM(rv.rev),0) INTO v_oppct
  FROM (SELECT period mes, SUM(balance) FILTER (WHERE account_code LIKE '6%') op_pool FROM public.odoo_account_balances
        WHERE period <= v_period AND period > to_char(((v_period||'-01')::date - interval '12 months'),'YYYY-MM') GROUP BY 1) gp
  JOIN (SELECT to_char(invoice_date,'YYYY-MM') mes, SUM(price_subtotal_mxn) rev FROM public.odoo_invoice_lines
        WHERE move_type='out_invoice' AND invoice_date < (((v_period||'-01')::date)+interval '1 month') AND invoice_date >= (((v_period||'-01')::date)-interval '11 months') GROUP BY 1) rv ON rv.mes=gp.mes
  WHERE gp.op_pool>0 AND rv.rev>0;
  DELETE FROM public.product_cost_catalog;
  INSERT INTO public.product_cost_catalog
  WITH prod AS (
    SELECT op.odoo_product_id, op.internal_ref, op.name, op.category, op.uom,
      COALESCE(kpu.kg_per_unit,0) AS conv, kpu.source AS peso_src, COALESCE(puc.m_per_kg,0) AS m_per_kg,
      (op.internal_ref ~ ' I$') AS is_import,
      (public.costo_bucket(op.category, op.name, op.internal_ref) IN ('ent_tejida','ent_carda')) AS is_ent,
      (public.costo_bucket(op.category, op.name, op.internal_ref) = 'ent_tejida') AS is_tejida,
      public.get_bom_mp_cost_lastcost(op.odoo_product_id) AS mp, op.list_price, op.standard_price
    FROM public.odoo_products op
    LEFT JOIN public.product_kg_per_unit kpu ON kpu.odoo_product_id=op.odoo_product_id
    LEFT JOIN public.product_uom_conversion puc ON puc.odoo_product_id=op.odoo_product_id
    WHERE op.active AND op.uom IN ('m','kg')
      AND op.category ILIKE 'Producto Terminado%'
      AND NOT (op.internal_ref ~* '^\s*(SALDO|DESPERDICIO)')
  ),
  px AS (
    SELECT rv.product_ref, rv.rev / NULLIF(q.qty,0) AS avg_price
    FROM (SELECT product_ref, SUM(price_subtotal_mxn) rev FROM public.odoo_invoice_lines
          WHERE move_type='out_invoice' AND invoice_date >= CURRENT_DATE - interval '12 months' AND product_ref IS NOT NULL GROUP BY 1) rv
    JOIN (SELECT product_ref, SUM(quantity) qty FROM
            (SELECT DISTINCT ON (odoo_move_id, product_ref, quantity) odoo_move_id, product_ref, quantity
             FROM public.odoo_invoice_lines WHERE move_type='out_invoice' AND invoice_date >= CURRENT_DATE - interval '12 months' AND product_ref IS NOT NULL AND quantity>0) d
          GROUP BY 1) q ON q.product_ref = rv.product_ref
  ),
  calc AS (
    SELECT p.*,
      CASE WHEN p.is_import THEN 0 ELSE p.conv * COALESCE(v_fkg,0) END AS energia,
      CASE WHEN p.is_import THEN 0
           WHEN p.is_tejida AND v_fent IS NOT NULL AND p.uom='m' THEN p.conv*COALESCE(v_fp,0) + COALESCE(v_fent,0)
           WHEN p.is_tejida AND v_fent IS NOT NULL AND p.uom='kg' THEN COALESCE(v_fp,0) + p.m_per_kg*COALESCE(v_fent,0)
           WHEN p.is_ent AND v_fent IS NOT NULL AND p.uom='m' THEN COALESCE(v_fent,0)
           WHEN p.is_ent AND v_fent IS NOT NULL AND p.uom='kg' THEN COALESCE(v_fent,0)*p.m_per_kg
           WHEN p.uom='m' THEN p.conv*COALESCE(v_fp,0) + COALESCE(v_fl,0)
           WHEN p.uom='kg' THEN COALESCE(v_fp,0) + p.m_per_kg*COALESCE(v_fl,0) ELSE 0 END AS fab,
      COALESCE(px.avg_price, CASE WHEN p.list_price > 1 THEN p.list_price ELSE NULLIF(p.standard_price,0) END) AS precio,
      CASE WHEN px.avg_price IS NOT NULL THEN 'venta_prom_12m' WHEN p.list_price > 1 THEN 'lista' WHEN p.standard_price>0 THEN 'avco' ELSE NULL END AS precio_fuente,
      CASE WHEN p.is_import THEN 'importado' WHEN p.is_tejida THEN 'Entretela tejida' WHEN p.is_ent THEN 'Entretela carda'
           WHEN p.uom='kg' THEN 'Tela por kg'
           WHEN p.category ILIKE '%Tac-%' OR p.category ILIKE '%Acabado%'
                OR (p.category ILIKE '%Tejido Circular%' AND p.category ILIKE '%resina%') THEN 'Tela acabado (m)'
           ELSE 'Otro' END AS familia
    FROM prod p LEFT JOIN px ON px.product_ref = p.internal_ref
  )
  SELECT c.odoo_product_id, c.internal_ref, c.name, c.category, c.familia, c.uom, ROUND(c.conv,5), c.peso_src,
    ROUND(c.mp,4), ROUND(c.energia,4), ROUND(c.mp + c.energia,4), ROUND(c.fab,4), ROUND(c.mp + c.fab,4),
    ROUND(c.precio,4), c.precio_fuente, ROUND(c.precio * COALESCE(v_oppct,0),4),
    ROUND(c.mp + c.fab + c.precio*COALESCE(v_oppct,0),4),
    CASE WHEN c.precio_fuente IN ('venta_prom_12m','lista') THEN ROUND(c.precio - (c.mp + c.energia),4) END,
    CASE WHEN c.precio_fuente IN ('venta_prom_12m','lista') AND c.precio>0 THEN ROUND((c.precio - (c.mp + c.energia))/c.precio*100,1) END,
    CASE WHEN c.precio_fuente IN ('venta_prom_12m','lista') AND c.precio>0 THEN ROUND((c.precio - (c.mp + c.fab + c.precio*COALESCE(v_oppct,0)))/c.precio*100,1) END,
    CASE WHEN EXISTS (SELECT 1 FROM public.mv_primary_bom pb WHERE pb.odoo_product_id=c.odoo_product_id) THEN 'bom_recursivo' WHEN c.is_import THEN 'importado' ELSE 'sin_bom' END,
    v_period, now()
  FROM calc c;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $function$;
