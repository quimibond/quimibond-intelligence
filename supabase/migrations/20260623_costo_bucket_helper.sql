-- Helper único de clasificación de costo (desacopla el cost model de los nombres de categoría).
--
-- Contexto: la reestructura del catálogo PT en Odoo (Tejido Circular / No Tejido × Con / Sin
-- resina, con el dibujo movido a Producto en Proceso) renombra las categorías que el cost model
-- usaba para clasificar producto→proceso. Antes esa clasificación vivía como ~38 patrones
-- ILIKE ('%Entretela%', '%Puntos%', '%tejida%', '%no tejid%') regados en ~5 funciones, frágiles
-- y parchados repetidamente (saga 20260612c→h). Este helper los reemplaza por UNA fuente de verdad.
--
-- AGNÓSTICO al import: devuelve solo la familia de proceso por categoría/nombre. El import
-- (' I$' → fab=0) se maneja por separado en cada función (via is_import), así no hay edge cases
-- en denominadores (p.ej. la 1 entretela importada que sí se manufactura quedaría fuera del
-- factor entretela si el helper la marcara 'import').
--
-- Reconoce la estructura PT NUEVA (explícita por categoría) y cae al fallback VIEJO idéntico,
-- de modo que mientras Odoo no sincronice las categorías nuevas, reproduce HOY byte-a-byte
-- (validado: 0 diffs sobre 7,339 productos en is_entretela e is_tejida).
--
-- Buckets de proceso de fabricación:
--   ent_tejida : base tejido circular + resina (puntos/fusible) → factor peso (tejido+tint) + factor entretela
--   ent_carda  : no tejido (carda/thermobond, con o sin resina)  → solo factor entretela
--   tela       : tela regular (tejido circular sin resina)        → factor híbrido peso+largo
CREATE OR REPLACE FUNCTION public.costo_bucket(p_cat text, p_name text, p_ref text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    -- estructura PT nueva (explícita por categoría)
    WHEN p_cat ILIKE '%Tejido Circular%' AND p_cat ILIKE '%Con resina%' THEN 'ent_tejida'
    WHEN p_cat ILIKE '%No Tejido%'       AND p_cat ILIKE '%resina%'      THEN 'ent_carda'   -- con o sin → carda
    WHEN p_cat ILIKE '%Tejido Circular%' AND p_cat ILIKE '%Sin resina%' THEN 'tela'
    -- estructura vieja (fallback idéntico a hoy)
    WHEN (p_cat ILIKE '%Entretela%' AND p_cat NOT ILIKE '%Importaci%')
         AND p_name NOT ILIKE '%no tejid%'
         AND (p_name ILIKE '%tejido circular%' OR p_name ILIKE '%tejida%' OR p_cat ILIKE '%Puntos%')
         THEN 'ent_tejida'
    WHEN (p_cat ILIKE '%Entretela%' AND p_cat NOT ILIKE '%Importaci%') THEN 'ent_carda'
    ELSE 'tela'
  END
$$;
