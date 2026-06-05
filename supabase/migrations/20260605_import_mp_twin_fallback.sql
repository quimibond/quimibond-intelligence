-- 2026-06-05: MP de importados sin costo propio → fallback al gemelo nacional.
--
-- Hallazgo (auditoría producto×producto): KP2032T11GO152 I (importado, $196k de
-- venta en abr-2026) salía con costo_primo MP = $0 porque no tiene historial de
-- compra ni avg_cost propio. Eso infla su margen. Su gemelo nacional
-- KP2032T11GO152 (tela en metros) sí tiene MP ($7.19/m último, $7.40 promedio).
--
-- Fix (mismo patrón que el peso 'import_twin'): cuando un importado (' I') no
-- tiene costo propio (último de compra / avg = 0), hereda el MP de su gemelo
-- nacional = mismo ref sin ' I', tela en metros (uom='m'). Se conserva el costo
-- propio cuando existe (es el landed cost real del importado). El gemelo no es
-- importado, así que no hay recursión infinita.

-- ── get_bom_mp_cost_lastcost: MP a ÚLTIMO costo ──
CREATE OR REPLACE FUNCTION public.get_bom_mp_cost_lastcost(p_product_id integer, p_max_depth integer DEFAULT 10)
RETURNS numeric
LANGUAGE sql
STABLE
AS $function$
WITH byproduct AS (
  SELECT 1 FROM public.canonical_products cp
  WHERE cp.odoo_product_id = p_product_id
    AND (cp.is_byproduct OR cp.internal_ref ~* '^\s*(SALDO|DESPERDICIO)')
),
imported AS (
  SELECT COALESCE(
    NULLIF(public.get_leaf_last_cost_mxn(p_product_id), 0),
    -- fallback: MP del gemelo nacional (mismo ref sin ' I', tela en metros)
    (SELECT public.get_bom_mp_cost_lastcost(tw.odoo_product_id)
     FROM public.canonical_products twc
     JOIN public.odoo_products tw
       ON tw.odoo_product_id = twc.odoo_product_id AND tw.uom = 'm'
     WHERE lower(btrim(twc.internal_ref)) = lower(btrim(regexp_replace(cp.internal_ref, '\s+I$', '')))
       AND twc.odoo_product_id <> cp.odoo_product_id
     ORDER BY tw.odoo_product_id LIMIT 1)
  ) AS cost
  FROM public.canonical_products cp
  WHERE cp.odoo_product_id = p_product_id
    AND cp.internal_ref ~ ' I$'
    AND NOT EXISTS (SELECT 1 FROM byproduct)
),
recursive_calc AS (
  WITH RECURSIVE explode AS (
    SELECT p_product_id::bigint AS cur, 1.0::numeric AS ratio,
           0 AS depth, ARRAY[p_product_id]::bigint[] AS visited
    WHERE NOT EXISTS (SELECT 1 FROM byproduct)
      AND NOT EXISTS (SELECT 1 FROM imported)
    UNION ALL
    SELECT bl.odoo_product_id::bigint,
           e.ratio * (bl.product_qty / NULLIF(pb.product_qty, 0)),
           e.depth + 1, e.visited || bl.odoo_product_id::bigint
    FROM explode e
    JOIN public.mv_primary_bom pb ON pb.odoo_product_id = e.cur
    JOIN public.mrp_bom_lines bl ON bl.odoo_bom_id = pb.odoo_bom_id
    WHERE e.depth < p_max_depth AND NOT bl.odoo_product_id = ANY(e.visited)
  )
  SELECT COALESCE(SUM(e.ratio * public.get_leaf_last_cost_mxn(e.cur::int)), 0)::numeric AS bom_cost
  FROM explode e
  WHERE NOT EXISTS (
    SELECT 1 FROM public.mv_primary_bom pb WHERE pb.odoo_product_id = e.cur
  )
)
SELECT COALESCE(
  (SELECT 0::numeric FROM byproduct),
  (SELECT cost FROM imported),
  (SELECT bom_cost FROM recursive_calc),
  0
)::numeric;
$function$;

-- ── get_bom_raw_material_cost_per_unit: MP a costo PROMEDIO ──
CREATE OR REPLACE FUNCTION public.get_bom_raw_material_cost_per_unit(p_product_id integer, p_max_depth integer DEFAULT 10)
RETURNS numeric
LANGUAGE sql
STABLE
AS $function$
WITH byproduct AS (
  SELECT 0::numeric AS zero_cost
  FROM public.canonical_products cp
  WHERE cp.odoo_product_id = p_product_id
    AND (cp.is_byproduct OR cp.internal_ref ~* '^\s*(SALDO|DESPERDICIO)')
),
cached AS (
  SELECT cost_per_unit
  FROM public.bom_recursive_cost_cache
  WHERE odoo_product_id = p_product_id
    AND refreshed_at > now() - interval '6 hours'
    AND NOT EXISTS (SELECT 1 FROM byproduct)
  LIMIT 1
),
imported_short_circuit AS (
  SELECT COALESCE(
    NULLIF(COALESCE(prac.avg_cost_mxn, cp.avg_cost_mxn), 0),
    -- fallback: MP promedio del gemelo nacional (ref sin ' I', tela en metros)
    (SELECT public.get_bom_raw_material_cost_per_unit(tw.odoo_product_id)
     FROM public.canonical_products twc
     JOIN public.odoo_products tw
       ON tw.odoo_product_id = twc.odoo_product_id AND tw.uom = 'm'
     WHERE lower(btrim(twc.internal_ref)) = lower(btrim(regexp_replace(cp.internal_ref, '\s+I$', '')))
       AND twc.odoo_product_id <> cp.odoo_product_id
     ORDER BY tw.odoo_product_id LIMIT 1)
  ) AS imported_cost
  FROM public.canonical_products cp
  LEFT JOIN public.product_real_avg_cost prac
    ON prac.odoo_product_id = cp.odoo_product_id
  WHERE cp.odoo_product_id = p_product_id
    AND cp.internal_ref ~ ' I$'
    AND NOT EXISTS (SELECT 1 FROM byproduct)
    AND NOT EXISTS (SELECT 1 FROM cached)
),
recursive_calc AS (
  WITH RECURSIVE explode AS (
    SELECT p_product_id::bigint AS current_product_id, 1.0::numeric AS qty_ratio,
           0 AS depth, ARRAY[p_product_id]::bigint[] AS visited
    WHERE NOT EXISTS (SELECT 1 FROM byproduct)
      AND NOT EXISTS (SELECT 1 FROM cached)
      AND NOT EXISTS (SELECT 1 FROM imported_short_circuit)
    UNION ALL
    SELECT bl.odoo_product_id::bigint,
           e.qty_ratio * (bl.product_qty / NULLIF(pb.product_qty, 0)),
           e.depth + 1, e.visited || bl.odoo_product_id::bigint
    FROM explode e
    JOIN public.mv_primary_bom pb ON pb.odoo_product_id = e.current_product_id
    JOIN public.mrp_bom_lines bl ON bl.odoo_bom_id = pb.odoo_bom_id
    WHERE e.depth < p_max_depth AND NOT bl.odoo_product_id = ANY(e.visited)
  )
  SELECT COALESCE(SUM(
    e.qty_ratio * CASE
      WHEN cp.is_byproduct OR cp.internal_ref ~* '^\s*(SALDO|DESPERDICIO)' THEN 0
      ELSE COALESCE(prac.avg_cost_mxn, cp.avg_cost_mxn, 0)
    END
  ), 0)::numeric AS bom_cost
  FROM explode e
  LEFT JOIN public.canonical_products cp
    ON cp.odoo_product_id = e.current_product_id
  LEFT JOIN public.product_real_avg_cost prac
    ON prac.odoo_product_id = e.current_product_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.mv_primary_bom pb
    WHERE pb.odoo_product_id = e.current_product_id
  )
)
SELECT COALESCE(
  (SELECT zero_cost FROM byproduct),
  (SELECT cost_per_unit FROM cached),
  (SELECT imported_cost FROM imported_short_circuit),
  (SELECT bom_cost FROM recursive_calc),
  0
)::numeric;
$function$;
