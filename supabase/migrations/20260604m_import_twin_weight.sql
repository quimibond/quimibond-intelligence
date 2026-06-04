-- 2026-06-04m: los productos de IMPORTACIÓN (' I') no traían peso, por lo que
-- conv=kg_per_unit=0 en get_full_cost_reconstruction y NO recibían NI
-- fabricación (correcto: solo se inspeccionan/reempacan) NI gastos de
-- OPERACIÓN (incorrecto: admin/ventas aplican a todo lo vendido).
--
-- Causa: los importados llevan código de resina (4032/9032 → sin gramaje
-- limpio) y su BOM es un stub (costo del proveedor extranjero + token de
-- importación), así que caían fuera de todas las fuentes de peso.
--
-- Fix: heredan el peso de su GEMELO nacional — mismo ref sin el sufijo ' I'
-- (p.ej. 'WP4032BL152 I' → 'WP4032BL152'). El gemelo debe ser tela en metros
-- (uom='m') para que el peso sea kg/m (evita heredar 1.0 de una variante kg).
-- Prioridad de gemelo: cvu > ref_gramaje > bom_weight > otros; desempate por
-- id. Así los importados entran al denominador de operación (kg vendidos) y
-- reciben su parte de 6xx; la fabricación sigue en 0 por el guard is_import
-- (' I$') de get_full_cost_reconstruction.
--
-- Solo aplica a ' I' (los ' IT' no se venden). source='import_twin',
-- overridable por 'manual'. Idempotente.
--
-- El gemelo SUSTITUYE cualquier peso propio no-manual del importado: su
-- odoo_weight es tan poco confiable como el de los nacionales (p.ej.
-- WP4032BL152 I traía odoo_weight=0.54, ~5× inflado vs el gemelo 0.106).
-- Si no hay gemelo en metros, el importado queda sin peso (op=0) en vez de
-- arrastrar un peso propio erróneo.

DELETE FROM public.product_kg_per_unit WHERE source = 'import_twin';

-- Quita el peso propio (no-manual) de importados ' I' en metros, para que el
-- gemelo sea la única fuente.
DELETE FROM public.product_kg_per_unit p
WHERE p.source NOT IN ('manual', 'import_twin')
  AND EXISTS (
    SELECT 1 FROM public.canonical_products cpi
    JOIN public.odoo_products opi ON opi.odoo_product_id = cpi.odoo_product_id AND opi.uom = 'm'
    WHERE cpi.odoo_product_id = p.odoo_product_id AND cpi.internal_ref ~ ' I$'
  );

INSERT INTO public.product_kg_per_unit (odoo_product_id, kg_per_unit, source)
SELECT t.odoo_product_id, t.twin_kg, 'import_twin'
FROM (
  SELECT DISTINCT ON (imp.odoo_product_id)
    imp.odoo_product_id, tw.kg_per_unit AS twin_kg
  FROM (
    SELECT cpi.odoo_product_id,
           btrim(regexp_replace(cpi.internal_ref, '\s+I$', '')) AS base_ref
    FROM public.canonical_products cpi
    JOIN public.odoo_products opi ON opi.odoo_product_id = cpi.odoo_product_id AND opi.uom = 'm'
    WHERE cpi.internal_ref ~ ' I$'
  ) imp
  JOIN public.canonical_products cpb
    ON lower(btrim(cpb.internal_ref)) = lower(imp.base_ref) AND cpb.odoo_product_id <> imp.odoo_product_id
  JOIN public.odoo_products opb ON opb.odoo_product_id = cpb.odoo_product_id AND opb.uom = 'm'
  JOIN public.product_kg_per_unit tw ON tw.odoo_product_id = cpb.odoo_product_id AND tw.source <> 'import_twin'
  ORDER BY imp.odoo_product_id,
    CASE tw.source WHEN 'cvu' THEN 1 WHEN 'ref_gramaje' THEN 2 WHEN 'bom_weight' THEN 3 ELSE 4 END,
    cpb.odoo_product_id
) t
ON CONFLICT (odoo_product_id) DO NOTHING;
