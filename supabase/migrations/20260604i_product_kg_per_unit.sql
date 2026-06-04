-- 2026-06-04i: peso (kg) por unidad de venta, para repartir gastos por PESO.
-- Fuente 1: CVU 1:1 real (refs con 1 producto-metro de entrada y 1 producto-kg
--   de salida) → kg_out/m_in. Fuente 2: gramaje (3 díg tras letras)×ancho del
--   ref. Fuente 3: weight de Odoo. kg nativos = 1. Overridable (source=manual).
CREATE TABLE IF NOT EXISTS public.product_kg_per_unit (
  odoo_product_id integer PRIMARY KEY,
  kg_per_unit numeric NOT NULL,
  source text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.product_kg_per_unit (odoo_product_id, kg_per_unit, source)
SELECT odoo_product_id, 1, 'kg_native' FROM public.odoo_products WHERE uom='kg'
ON CONFLICT (odoo_product_id) DO NOTHING;

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

INSERT INTO public.product_kg_per_unit (odoo_product_id, kg_per_unit, source)
SELECT cp.odoo_product_id, g.gramaje*(w.ancho_cm/100.0)/1000.0, 'ref_gramaje'
FROM public.canonical_products cp JOIN public.odoo_products op ON op.odoo_product_id=cp.odoo_product_id AND op.uom='m'
CROSS JOIN LATERAL (SELECT NULLIF((regexp_match(cp.internal_ref, '^[A-Za-z]+(\d{3})'))[1],'')::numeric AS gramaje) g
CROSS JOIN LATERAL (SELECT NULLIF((regexp_match(cp.internal_ref, '(\d{3})[^0-9]*$'))[1],'')::numeric AS ancho_cm) w
WHERE g.gramaje BETWEEN 20 AND 400 AND w.ancho_cm BETWEEN 80 AND 320
  AND g.gramaje*(w.ancho_cm/100.0)/1000.0 BETWEEN 0.01 AND 1.5
ON CONFLICT (odoo_product_id) DO NOTHING;

INSERT INTO public.product_kg_per_unit (odoo_product_id, kg_per_unit, source)
SELECT odoo_product_id, weight, 'odoo_weight' FROM public.odoo_products
WHERE uom='m' AND weight BETWEEN 0.01 AND 1.5
ON CONFLICT (odoo_product_id) DO NOTHING;
