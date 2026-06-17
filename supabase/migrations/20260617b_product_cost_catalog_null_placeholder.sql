-- 2026-06-17b: el catalogo de costos no muestra margen cuando el precio es
-- placeholder (AVCO de un producto nunca vendido). Antes ~990 productos salian
-- con "margen negativo" falso: nunca se vendieron, su AVCO placeholder caia por
-- debajo del MP por BOM. Fix: contribucion/cm_pct/margen_absorbido solo se
-- calculan cuando el precio viene de venta real (12m) o lista; con AVCO -> NULL
-- (se siguen mostrando los costos). De 1,039 negativos -> 49 (11 venta real +
-- 38 lista). Los 11 reales: BOMs infladas (WJ050/WC090/IXJ140 - error Odoo),
-- precios internos $30 en greige, energia mal aplicada a fibra revendida, e
-- importados vendidos algo bajo costo landed. Funcion final aplicada via
-- apply_migration (identica a 20260617 + dedup de qty + este guard).

CREATE OR REPLACE FUNCTION public.refresh_product_cost_catalog(p_period text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql AS $function$
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
      (op.category ILIKE '%Entretela%' AND op.category NOT ILIKE '%Importaci%') AS is_ent,
      (op.category ILIKE '%Entretela%' AND op.category NOT ILIKE '%Importaci%' AND op.name NOT ILIKE '%no tejid%'
        AND (op.name ILIKE '%tejido circular%' OR op.name ILIKE '%tejida%' OR op.category ILIKE '%Puntos%')) AS is_tejida,
      public.get_bom_mp_cost_lastcost(op.odoo_product_id) AS mp, op.list_price, op.standard_price
    FROM public.odoo_products op
    LEFT JOIN public.product_kg_per_unit kpu ON kpu.odoo_product_id=op.odoo_product_id
    LEFT JOIN public.product_uom_conversion puc ON puc.odoo_product_id=op.odoo_product_id
    WHERE op.active AND op.uom IN ('m','kg')
      AND (op.category ILIKE '%Producto Terminado%' OR op.category ILIKE '%Producto En Proceso%' OR op.category ILIKE '%Entretela%' OR op.category ILIKE '%Tac-%')
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
           WHEN p.uom='kg' THEN 'Tela greige (kg)' WHEN p.category ILIKE '%Tac-%' OR p.category ILIKE '%Acabado%' THEN 'Tela acabado (m)' ELSE 'Otro' END AS familia
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
