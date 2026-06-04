-- 2026-06-04d: Conversión kg → metros por producto, para costear la tela
-- vendida por peso (kg) con el mismo factor $/metro.
-- Fuente 1: CVU real (órdenes TL/CVU que consumen metros y producen kg).
-- Fuente 2 (fallback): gramaje×ancho del internal_ref (IWJ045...160 =
-- 45 g/m² × 1.60 m → m_per_kg = 1000/(45*1.60) = 13.9). Confirmado por CEO.
-- Tabla overridable por SKU (editar m_per_kg + source='manual').
CREATE TABLE IF NOT EXISTS public.product_uom_conversion (
  odoo_product_id integer PRIMARY KEY,
  m_per_kg numeric NOT NULL,
  gramaje_g_m2 numeric,
  ancho_m numeric,
  source text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.product_uom_conversion (odoo_product_id, m_per_kg, source)
SELECT o.kg_pid, SUM(i.m_in)/NULLIF(SUM(o.kg_out),0), 'cvu'
FROM (
  SELECT csm.reference, csm.odoo_product_id AS kg_pid, SUM(csm.quantity) AS kg_out
  FROM public.canonical_stock_moves csm
  JOIN public.odoo_products op ON op.odoo_product_id=csm.odoo_product_id AND op.uom='kg'
  WHERE csm.reference LIKE 'TL/CVU%' AND csm.state='done' AND csm.is_in=true AND csm.quantity>0
  GROUP BY 1,2
) o
JOIN (
  SELECT csm.reference, SUM(csm.quantity) AS m_in
  FROM public.canonical_stock_moves csm
  JOIN public.odoo_products op ON op.odoo_product_id=csm.odoo_product_id AND op.uom='m'
  WHERE csm.reference LIKE 'TL/CVU%' AND csm.state='done' AND csm.is_in=false AND csm.quantity>0
  GROUP BY 1
) i ON i.reference=o.reference
GROUP BY o.kg_pid
HAVING SUM(o.kg_out) > 0 AND SUM(i.m_in)/NULLIF(SUM(o.kg_out),0) BETWEEN 1 AND 100
ON CONFLICT (odoo_product_id) DO NOTHING;

INSERT INTO public.product_uom_conversion (odoo_product_id, m_per_kg, gramaje_g_m2, ancho_m, source)
SELECT cp.odoo_product_id,
       1000.0 / (g.gramaje * (w.ancho_cm/100.0)),
       g.gramaje, w.ancho_cm/100.0, 'ref_gramaje'
FROM public.canonical_products cp
JOIN public.odoo_products op ON op.odoo_product_id=cp.odoo_product_id AND op.uom='kg'
CROSS JOIN LATERAL (SELECT NULLIF((regexp_match(cp.internal_ref, '(\d{3})'))[1],'')::numeric AS gramaje) g
CROSS JOIN LATERAL (SELECT NULLIF((regexp_match(cp.internal_ref, '(\d{3})[^0-9]*$'))[1],'')::numeric AS ancho_cm) w
WHERE g.gramaje BETWEEN 20 AND 400
  AND w.ancho_cm BETWEEN 80 AND 320
  AND 1000.0/(g.gramaje*(w.ancho_cm/100.0)) BETWEEN 1 AND 100
ON CONFLICT (odoo_product_id) DO NOTHING;
