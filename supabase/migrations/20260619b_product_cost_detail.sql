-- Desglose de costo por producto para la UI (/contabilidad/costos-producto).
--
-- Dos objetos:
-- 1) get_cost_pool_composition(p_period): composición % del pool de fabricación
--    (MOD/energía/renta/depreciación/maquinaria) y de operación (602/603/otros),
--    calculada sobre el YTD del año del período (ventana limpia, sin el reverso
--    del cierre anual de diciembre que corrompe una ventana móvil de 12m).
--    La UI multiplica fab_unit/op_unit × share para desglosar por producto.
-- 2) product_mp_breakdown: materia prima por componente de receta (BOM explotada
--    al último costo, agrupada en Hilo/Colorante/Químicos/Resina/Fibra/
--    Semiterminado/Maquila/Otros; importados = landed). Escalada a mp_unit del
--    catálogo para que Σ buckets = MP. Refrescada nocturno tras el catálogo.

CREATE OR REPLACE FUNCTION public.get_cost_pool_composition(p_period text)
RETURNS TABLE(layer text, component text, amount_mxn numeric, share numeric)
LANGUAGE sql STABLE AS $$
WITH w AS (
  SELECT account_code, balance FROM public.odoo_account_balances
  WHERE period >= to_char(date_trunc('year',(p_period||'-01')::date),'YYYY-MM') AND period <= p_period
),
u AS (
  SELECT 'fab' layer, 1 ord, 'MOD (501.06)' comp, SUM(balance) amt FROM w WHERE account_code LIKE '501.06%'
  UNION ALL SELECT 'fab',2,'Energía — Luz (504.01.0001)', SUM(balance) FROM w WHERE account_code LIKE '504.01.0001%'
  UNION ALL SELECT 'fab',3,'Energía — Gas (504.01.0003)', SUM(balance) FROM w WHERE account_code LIKE '504.01.0003%'
  UNION ALL SELECT 'fab',4,'Energía — Agua (504.01.0004)', SUM(balance) FROM w WHERE account_code LIKE '504.01.0004%'
  UNION ALL SELECT 'fab',5,'Renta de planta (504.01.0008)', SUM(balance) FROM w WHERE account_code LIKE '504.01.0008%'
  UNION ALL SELECT 'fab',6,'Otros overhead fábrica (504.01)', SUM(balance) FROM w WHERE account_code LIKE '504.01%' AND account_code NOT LIKE '504.01.0001%' AND account_code NOT LIKE '504.01.0003%' AND account_code NOT LIKE '504.01.0004%' AND account_code NOT LIKE '504.01.0008%'
  UNION ALL SELECT 'fab',7,'Depreciación de fábrica (504.08–23)', SUM(balance) FROM w WHERE account_code ~ '^504\.(0[89]|1[0-9]|2[0-3])'
  UNION ALL SELECT 'fab',8,'Arrend. de maquinaria (701.11)', SUM(balance) FROM w WHERE account_code LIKE '701.11%'
  UNION ALL SELECT 'op',11,'Administración y ventas (602)', SUM(balance) FROM w WHERE account_code LIKE '602%'
  UNION ALL SELECT 'op',12,'Corporativo / CORPO (603)', SUM(balance) FROM w WHERE account_code LIKE '603%'
  UNION ALL SELECT 'op',13,'Otros (601 + 613)', SUM(balance) FROM w WHERE account_code LIKE '601%' OR account_code LIKE '613%'
)
SELECT layer, comp, ROUND(amt,2), ROUND(amt/NULLIF(SUM(amt) OVER (PARTITION BY layer),0),6)
FROM u WHERE amt > 0 ORDER BY ord;
$$;

CREATE TABLE IF NOT EXISTS public.product_mp_breakdown (
  odoo_product_id integer NOT NULL,
  bucket text NOT NULL,
  cost_unit_mxn numeric,
  PRIMARY KEY (odoo_product_id, bucket)
);

CREATE OR REPLACE FUNCTION public.refresh_product_mp_breakdown()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM public.product_mp_breakdown;
  INSERT INTO public.product_mp_breakdown(odoo_product_id, bucket, cost_unit_mxn)
  WITH RECURSIVE seeds AS (
    SELECT pcc.odoo_product_id root, op.internal_ref ref, pcc.mp_unit_mxn mp_u, (op.internal_ref ~ ' I$') is_imp
    FROM public.product_cost_catalog pcc JOIN public.odoo_products op USING(odoo_product_id)
  ),
  explode AS (
    SELECT s.root, s.root::bigint cur, 1.0::numeric ratio, 0 depth, ARRAY[s.root]::bigint[] visited
    FROM seeds s WHERE NOT s.is_imp
    UNION ALL
    SELECT e.root, bl.odoo_product_id::bigint, e.ratio*(bl.product_qty/NULLIF(pb.product_qty,0)), e.depth+1, e.visited||bl.odoo_product_id::bigint
    FROM explode e JOIN public.mv_primary_bom pb ON pb.odoo_product_id=e.cur
    JOIN public.mrp_bom_lines bl ON bl.odoo_bom_id=pb.odoo_bom_id
    WHERE e.depth<10 AND NOT bl.odoo_product_id=ANY(e.visited)
  ),
  leaves AS (
    SELECT e.root, e.cur leaf, e.ratio FROM explode e
    WHERE NOT EXISTS (SELECT 1 FROM public.mv_primary_bom pb WHERE pb.odoo_product_id=e.cur)
  ),
  bucketed AS (
    SELECT l.root,
      CASE
        WHEN op.category ILIKE '%hilo%' THEN 'Hilo'
        WHEN op.category ILIKE '%Colorante%' THEN 'Colorante/Tintura'
        WHEN op.category ILIKE '%Quimico%' OR op.category ILIKE '%Químico%' OR op.category ILIKE '%procesados%' OR op.category ILIKE '%Cocina%' THEN 'Químicos'
        WHEN op.category ILIKE '%Resina%' THEN 'Resina'
        WHEN op.category ILIKE '%Fibra%' THEN 'Fibra'
        WHEN op.category ILIKE '%Producto En Proceso%' OR op.category ILIKE '%Producto Terminado%' THEN 'Semiterminado/proceso'
        WHEN op.category ILIKE '%Maquila%' THEN 'Maquila'
        ELSE 'Otros'
      END bucket,
      SUM(l.ratio*public.get_leaf_last_cost_mxn(l.leaf::int)) c
    FROM leaves l JOIN public.odoo_products op ON op.odoo_product_id=l.leaf
    GROUP BY 1,2 HAVING SUM(l.ratio*public.get_leaf_last_cost_mxn(l.leaf::int)) <> 0
  ),
  tot AS (SELECT root, SUM(c) t FROM bucketed GROUP BY 1)
  SELECT b.root, b.bucket, ROUND(b.c * s.mp_u / NULLIF(t.t,0), 5)
  FROM bucketed b JOIN tot t ON t.root=b.root JOIN seeds s ON s.root=b.root WHERE t.t<>0 AND s.mp_u IS NOT NULL
  UNION ALL
  SELECT s.root, 'Importado (landed)', ROUND(s.mp_u,5) FROM seeds s WHERE s.is_imp AND COALESCE(s.mp_u,0)<>0
  UNION ALL
  SELECT s.root, 'Otros', ROUND(s.mp_u,5) FROM seeds s
  WHERE NOT s.is_imp AND COALESCE(s.mp_u,0)<>0 AND NOT EXISTS (SELECT 1 FROM tot t WHERE t.root=s.root AND t.t<>0);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
