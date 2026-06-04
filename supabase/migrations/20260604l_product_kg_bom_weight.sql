-- 2026-06-04l: peso (kg) por unidad — fix de productos con código de resina.
--
-- Problema (reportado por CEO): refs como ZN4032BL152, AT9032BL152, WP4032
-- llevan un CÓDIGO DE RESINA de 4 dígitos (4032 / 9032), NO un gramaje. El
-- heurístico ref_gramaje `^[A-Za-z]+(\d{3})` agarraba los 3 primeros dígitos
-- (403, 903) como si fueran g/m². Para ZN4032BL152 quedaba fuera del rango
-- (403>400) y caía a odoo_weight=0.48 kg/m, que está ~5× inflado: el peso
-- real por BOM es ~0.092 kg/m. odoo_weight además es inconsistente (unos
-- guardan kg/m, otros g/m²).
--
-- Fix:
--  1) get_bom_weight_per_unit(): explota la BOM recursivamente y suma el peso
--     real de cada hoja (hilo/químico en kg, tela base en m × su kg/m). El
--     agua (uom L) y servicios se ignoran. Es lo que el CEO pidió:
--     "revisa su bom para que sepas cuánto pesa".
--  2) ref_gramaje sólo aplica cuando el primer bloque numérico tras las letras
--     tiene EXACTAMENTE 3 dígitos (así 4032/9032 ya no se malinterpretan; 045,
--     140 sí siguen valiendo como gramaje).
--  3) Re-seed de product_kg_per_unit con prioridad:
--     kg_native > cvu (medido) > ref_gramaje (3 díg, spec de ingeniería) >
--     bom_weight (receta, para los que NO traen gramaje limpio, p.ej. códigos
--     de resina) > odoo_weight. Se respetan overrides manuales (source='manual').
--     ref_gramaje va antes que bom_weight porque la receta sobre-estima en
--     algunos productos (p.ej. WC090...=1.48 kg/m, irreal para 90 g/m²); cuando
--     hay gramaje limpio de 3 díg es la fuente más confiable.

-- ── leaf_kg_per_unit: peso de una hoja (sin BOM) por 1 unidad de su uom ──
CREATE OR REPLACE FUNCTION public.leaf_kg_per_unit(p_product_id integer)
RETURNS numeric
LANGUAGE sql
STABLE
AS $function$
  SELECT CASE
    WHEN op.uom = 'kg' THEN 1::numeric
    WHEN op.uom = 'm' THEN COALESCE(
      -- gramaje SÓLO si el primer bloque numérico tras las letras es de 3 díg
      (CASE WHEN length((regexp_match(op.internal_ref, '^[A-Za-z]+(\d+)'))[1]) = 3
                 AND (regexp_match(op.internal_ref, '^[A-Za-z]+(\d{3})'))[1]::numeric BETWEEN 20 AND 400
                 AND (regexp_match(op.internal_ref, '(\d{3})[^0-9]*$'))[1]::numeric BETWEEN 80 AND 320
            THEN (regexp_match(op.internal_ref, '^[A-Za-z]+(\d{3})'))[1]::numeric
                 * ((regexp_match(op.internal_ref, '(\d{3})[^0-9]*$'))[1]::numeric / 100.0) / 1000.0
       END),
      -- fallback: peso de Odoo sólo si está en rango plausible kg/m
      (CASE WHEN op.weight BETWEEN 0.01 AND 1.5 THEN op.weight END)
    )
    ELSE NULL  -- servicios, L (agua), piezas: no aportan al peso de la tela
  END
  FROM public.odoo_products op
  WHERE op.odoo_product_id = p_product_id;
$function$;

-- ── get_bom_weight_per_unit: peso recursivo desde la receta ──
-- Explota la BOM (mv_primary_bom + mrp_bom_lines) y suma ratio×leaf_kg de cada
-- hoja. Para 1 m de PT devuelve kg/m. Guard de ciclos por depth + visited.
CREATE OR REPLACE FUNCTION public.get_bom_weight_per_unit(p_product_id integer, p_max_depth integer DEFAULT 10)
RETURNS numeric
LANGUAGE sql
STABLE
AS $function$
WITH RECURSIVE explode AS (
  SELECT p_product_id::bigint AS cur, 1.0::numeric AS ratio,
         0 AS depth, ARRAY[p_product_id]::bigint[] AS visited
  UNION ALL
  SELECT bl.odoo_product_id::bigint,
         e.ratio * (bl.product_qty / NULLIF(pb.product_qty, 0)),
         e.depth + 1, e.visited || bl.odoo_product_id::bigint
  FROM explode e
  JOIN public.mv_primary_bom pb ON pb.odoo_product_id = e.cur
  JOIN public.mrp_bom_lines bl ON bl.odoo_bom_id = pb.odoo_bom_id
  WHERE e.depth < p_max_depth AND NOT bl.odoo_product_id = ANY(e.visited)
)
SELECT COALESCE(SUM(e.ratio * COALESCE(public.leaf_kg_per_unit(e.cur::int), 0)), 0)::numeric
FROM explode e
WHERE NOT EXISTS (SELECT 1 FROM public.mv_primary_bom pb WHERE pb.odoo_product_id = e.cur);
$function$;

-- ── Re-seed product_kg_per_unit (respeta source='manual') ──
DELETE FROM public.product_kg_per_unit WHERE source <> 'manual';

-- 1) kg nativos
INSERT INTO public.product_kg_per_unit (odoo_product_id, kg_per_unit, source)
SELECT odoo_product_id, 1, 'kg_native' FROM public.odoo_products WHERE uom='kg'
ON CONFLICT (odoo_product_id) DO NOTHING;

-- 2) CVU 1:1 (conversión medida real)
WITH refs_1to1 AS (
  SELECT z.reference FROM (
    SELECT csm.reference,
      COUNT(DISTINCT csm.odoo_product_id) FILTER (WHERE op.uom='m' AND csm.is_in=false) AS n_m_in,
      COUNT(DISTINCT csm.odoo_product_id) FILTER (WHERE op.uom='kg' AND csm.is_in=true) AS n_kg_out
    FROM public.canonical_stock_moves csm
    JOIN public.odoo_products op ON op.odoo_product_id=csm.odoo_product_id
    WHERE csm.reference LIKE 'TL/CVU%' AND csm.state='done' AND csm.quantity>0
    GROUP BY 1) z WHERE z.n_m_in=1 AND z.n_kg_out=1
),
m_in AS (
  SELECT csm.reference, csm.odoo_product_id AS pid, SUM(csm.quantity) AS m
  FROM public.canonical_stock_moves csm JOIN public.odoo_products op ON op.odoo_product_id=csm.odoo_product_id AND op.uom='m'
  JOIN refs_1to1 r ON r.reference=csm.reference
  WHERE csm.state='done' AND csm.is_in=false AND csm.quantity>0 GROUP BY 1,2
),
kg_out AS (
  SELECT csm.reference, SUM(csm.quantity) AS kg
  FROM public.canonical_stock_moves csm JOIN public.odoo_products op ON op.odoo_product_id=csm.odoo_product_id AND op.uom='kg'
  JOIN refs_1to1 r ON r.reference=csm.reference
  WHERE csm.state='done' AND csm.is_in=true AND csm.quantity>0 GROUP BY 1
)
INSERT INTO public.product_kg_per_unit (odoo_product_id, kg_per_unit, source)
SELECT mi.pid, SUM(ko.kg)/NULLIF(SUM(mi.m),0), 'cvu'
FROM m_in mi JOIN kg_out ko ON ko.reference=mi.reference
GROUP BY mi.pid HAVING SUM(ko.kg)/NULLIF(SUM(mi.m),0) BETWEEN 0.01 AND 1.5
ON CONFLICT (odoo_product_id) DO NOTHING;

-- 3) Gramaje del ref (SÓLO bloque de exactamente 3 dígitos) — spec confiable
INSERT INTO public.product_kg_per_unit (odoo_product_id, kg_per_unit, source)
SELECT cp.odoo_product_id, g.gramaje*(w.ancho_cm/100.0)/1000.0, 'ref_gramaje'
FROM public.canonical_products cp JOIN public.odoo_products op ON op.odoo_product_id=cp.odoo_product_id AND op.uom='m'
CROSS JOIN LATERAL (SELECT
  CASE WHEN length((regexp_match(cp.internal_ref, '^[A-Za-z]+(\d+)'))[1]) = 3
       THEN (regexp_match(cp.internal_ref, '^[A-Za-z]+(\d{3})'))[1]::numeric END AS gramaje) g
CROSS JOIN LATERAL (SELECT NULLIF((regexp_match(cp.internal_ref, '(\d{3})[^0-9]*$'))[1],'')::numeric AS ancho_cm) w
WHERE g.gramaje BETWEEN 20 AND 400 AND w.ancho_cm BETWEEN 80 AND 320
  AND g.gramaje*(w.ancho_cm/100.0)/1000.0 BETWEEN 0.01 AND 1.5
ON CONFLICT (odoo_product_id) DO NOTHING;

-- 4) Peso por BOM recursivo (receta) — para tela en m SIN gramaje limpio
--    (p.ej. códigos de resina ZN4032/AT9032/WP4032)
INSERT INTO public.product_kg_per_unit (odoo_product_id, kg_per_unit, source)
SELECT op.odoo_product_id, w.kg, 'bom_weight'
FROM public.odoo_products op
JOIN public.mv_primary_bom pb ON pb.odoo_product_id = op.odoo_product_id
CROSS JOIN LATERAL (SELECT public.get_bom_weight_per_unit(op.odoo_product_id) AS kg) w
WHERE op.uom='m' AND w.kg BETWEEN 0.02 AND 1.5
ON CONFLICT (odoo_product_id) DO NOTHING;

-- 5) Peso de Odoo (último recurso, sólo rango plausible kg/m)
INSERT INTO public.product_kg_per_unit (odoo_product_id, kg_per_unit, source)
SELECT odoo_product_id, weight, 'odoo_weight' FROM public.odoo_products
WHERE uom='m' AND weight BETWEEN 0.01 AND 1.5
ON CONFLICT (odoo_product_id) DO NOTHING;
