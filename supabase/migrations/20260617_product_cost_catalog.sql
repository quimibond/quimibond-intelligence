-- 2026-06-17: catalogo de costos por producto (TODOS los vendibles, vendidos o no).
-- Tabla materializada product_cost_catalog + refresh_product_cost_catalog(p_period).
-- Alimenta /contabilidad/costos-producto (explorador/buscador). Refresh nocturno
-- via /api/pipeline/refresh-cogs-monthly. Desglose por unidad: MP (ultimo costo),
-- energia (variable), costo variable, fab absorbido por proceso, costo absorbido,
-- precio referencia (prom 12m con qty deduplicada por triplet, o lista/avco),
-- contribucion y margenes. Reusa la clasificacion del modelo (tejida/carda/import).
-- Los cuerpos vigentes (tabla + funcion) se aplicaron via apply_migration; este
-- archivo deja la version final reproducible.

CREATE TABLE IF NOT EXISTS public.product_cost_catalog (
  odoo_product_id integer PRIMARY KEY,
  internal_ref text, name text, category text, familia text, uom text,
  kg_per_unit numeric, peso_source text,
  mp_unit_mxn numeric, energia_unit_mxn numeric, costo_variable_unit_mxn numeric,
  fab_absorbido_unit_mxn numeric, costo_prod_absorbido_unit_mxn numeric,
  precio_ref_mxn numeric, precio_fuente text, op_unit_mxn numeric,
  costo_total_absorbido_unit_mxn numeric, contribucion_unit_mxn numeric,
  cm_pct numeric, margen_absorbido_pct numeric, mp_source text,
  period text, refreshed_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pcc_ref ON public.product_cost_catalog (internal_ref);
CREATE INDEX IF NOT EXISTS idx_pcc_familia ON public.product_cost_catalog (familia);

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
    ROUND(c.mp + c.fab + c.precio*COALESCE(v_oppct,0),4), ROUND(c.precio - (c.mp + c.energia),4),
    ROUND(CASE WHEN c.precio>0 THEN (c.precio - (c.mp + c.energia))/c.precio*100 END,1),
    ROUND(CASE WHEN c.precio>0 THEN (c.precio - (c.mp + c.fab + c.precio*COALESCE(v_oppct,0)))/c.precio*100 END,1),
    CASE WHEN EXISTS (SELECT 1 FROM public.mv_primary_bom pb WHERE pb.odoo_product_id=c.odoo_product_id) THEN 'bom_recursivo' WHEN c.is_import THEN 'importado' ELSE 'sin_bom' END,
    v_period, now()
  FROM calc c;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $function$;
