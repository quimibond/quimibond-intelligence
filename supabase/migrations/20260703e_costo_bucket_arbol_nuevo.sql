-- 2026-07-03e: clasificador de costos para el ÁRBOL DE CATEGORÍAS NUEVO.
--
-- El CEO reorganizó el árbol de product.category en Odoo (2026-07-03):
--   PT / Tejido Circular / {Industrial (telas), Entretela fusionable tejida}
--   PT / No Tejido / {Entretela fusionable, Entretela sin resina, Perfoquim}
--   PT / {Importación|Importado, Subproducto}
--   PP / {Tejido Circular (H), Teñido (I), Acabado, Carda, Cocina, Aux. acabado, Importación (IT)}
-- El mercado quedó DERIVADO: entretela ⇒ confección (401.01.01), tela ⇒ industrial (401.01.02).
--
-- Rutas nuevas que el clasificador viejo perdía:
--   · "PT / No Tejido / Perfoquim" ya no contiene 'Entretela' → caía a 'tela' (factor equivocado).
--   · "PT / TC / Entretela fusionable tejida" ya no contiene 'Puntos' ni 'Con resina' → las
--     tejidas sin 'tejido circular' en el NOMBRE caían a ent_carda.
--   · "PT / TC / Industrial" ya no contiene 'Sin resina' → familia de reporting caía a 'Otro'.
--   · get_production_by_cost_center buscaba '%Entretelas%' (plural) y '%Tac-%' (categorías
--     legacy que se están borrando).
-- Los patrones VIEJOS se conservan como fallback (histórico + transición).

-- 1) costo_bucket — la única fuente de verdad tela / ent_tejida / ent_carda
CREATE OR REPLACE FUNCTION public.costo_bucket(p_cat text, p_name text, p_ref text)
RETURNS text LANGUAGE sql IMMUTABLE AS $function$
  SELECT CASE
    -- árbol nuevo (2026-07-03): la hoja lo dice explícito
    WHEN p_cat ILIKE '%fusionable tejida%' THEN 'ent_tejida'
    WHEN p_cat ILIKE '%Perfoquim%' THEN 'ent_carda'
    WHEN p_cat ILIKE '%No Tejido%' AND (p_cat ILIKE '%resina%' OR p_cat ILIKE '%Entretela%') THEN 'ent_carda'
    WHEN p_cat ILIKE '%No Tejido' THEN 'ent_carda'   -- productos varados en el padre
    -- árbol intermedio (renombres de junio)
    WHEN p_cat ILIKE '%Tejido Circular%' AND p_cat ILIKE '%Con resina%' THEN 'ent_tejida'
    WHEN p_cat ILIKE '%Tejido Circular%' AND p_cat ILIKE '%Sin resina%' THEN 'tela'
    -- estructura vieja (fallback histórico intacto)
    WHEN (p_cat ILIKE '%Entretela%' AND p_cat NOT ILIKE '%Importaci%')
         AND p_name NOT ILIKE '%no tejid%'
         AND (p_name ILIKE '%tejido circular%' OR p_name ILIKE '%tejida%' OR p_cat ILIKE '%Puntos%')
         THEN 'ent_tejida'
    WHEN (p_cat ILIKE '%Entretela%' AND p_cat NOT ILIKE '%Importaci%') THEN 'ent_carda'
    ELSE 'tela'
  END
$function$;

-- 2) get_cost_audit_by_family — familias de reporting con las rutas nuevas
CREATE OR REPLACE FUNCTION public.get_cost_audit_by_family(p_period text)
RETURNS TABLE(familia text, n integer, mp_mxn numeric, fab_mxn numeric, op_mxn numeric, revenue_mxn numeric)
LANGUAGE sql STABLE AS $function$
  SELECT
    CASE
      WHEN (op.category ILIKE '%Importaci%' OR op.category ILIKE '%Importado%')
           AND (op.name ILIKE '%entretela%' OR op.category ILIKE '%Entretela%') THEN 'Entretela importada'
      WHEN public.costo_bucket(op.category, op.name, r.product_ref) = 'ent_tejida' THEN 'Entretela tejida'
      WHEN public.costo_bucket(op.category, op.name, r.product_ref) = 'ent_carda' THEN 'Entretela carda'
      WHEN r.product_ref ~ ' I$' THEN 'Importado (tela)'
      WHEN op.uom='kg' THEN 'Tela por kg'
      WHEN op.category ILIKE '%Tac-%' OR op.category ILIKE '%Acabado%'
           OR op.category ILIKE '%Tejido Circular%' THEN 'Tela acabado (m)'
      ELSE 'Otro'
    END AS familia,
    count(*)::int, COALESCE(sum(r.costo_primo_total_mxn),0)::numeric, COALESCE(sum(r.gastos_fab_total_mxn),0)::numeric,
    COALESCE(sum(r.gastos_op_total_mxn),0)::numeric, COALESCE(sum(r.revenue_mxn),0)::numeric
  FROM public.get_full_cost_reconstruction(p_period) r
  JOIN public.odoo_products op ON op.odoo_product_id = r.odoo_product_id
  GROUP BY 1 ORDER BY 4 DESC;
$function$;

-- 3) get_production_by_cost_center — matchers por centro con árbol nuevo + legacy
CREATE OR REPLACE FUNCTION public.get_production_by_cost_center(p_period text)
RETURNS TABLE(cost_center_code text, cost_center_name text, qty_produced numeric, output_uom text, num_moves bigint, value_produced_mxn numeric)
LANGUAGE sql STABLE AS $function$
SELECT
  cc.code AS cost_center_code,
  cc.name AS cost_center_name,
  SUM(csm.quantity)::numeric AS qty_produced,
  cc.output_uom,
  COUNT(*)::bigint AS num_moves,
  SUM(csm.value)::numeric AS value_produced_mxn
FROM public.canonical_stock_moves csm
JOIN public.odoo_products op ON op.odoo_product_id = csm.odoo_product_id
JOIN public.cost_center_config cc ON
  (cc.code = 'TEJIDO' AND (op.category ILIKE '%Tac-%Tejido Circular%'
                           OR op.category ILIKE '%Proceso / Tejido Circular%'))
  OR (cc.code = 'ACABADO' AND (op.category ILIKE '%Tac-%Acabado%'
                               OR op.category ILIKE '%Proceso / Acabado%'
                               OR (op.category ILIKE '%Terminado / Tejido Circular%'
                                   AND op.category NOT ILIKE '%fusionable tejida%')))
  OR (cc.code = 'TINTORERIA' AND (op.category ILIKE '%Tac-%Teñido%'
                                  OR op.category ILIKE '%Proceso / Teñido%'))
  OR (cc.code = 'ENTRETELAS' AND (op.category ILIKE '%Entretela%' OR op.category ILIKE '%Perfoquim%'
                                  OR op.category ILIKE '%No Tejido%' OR op.category ILIKE '%/ Carda%')
                              AND op.category NOT ILIKE '%Importaci%')
WHERE csm.move_category = 'produccion_pt'
  AND csm.state = 'done'
  AND csm.date >= (p_period || '-01')::date
  AND csm.date < (date_trunc('month', (p_period || '-01')::date) + interval '1 month')::date
GROUP BY cc.code, cc.name, cc.output_uom
ORDER BY cc.code;
$function$;

-- 4) refresh_product_cost_catalog — familia "Tela acabado (m)" con la hoja Industrial nueva
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
                OR p.category ILIKE '%Tejido Circular%' THEN 'Tela acabado (m)'
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

-- 5) refresh inmediato del catálogo con el clasificador nuevo
SELECT public.refresh_product_cost_catalog();
