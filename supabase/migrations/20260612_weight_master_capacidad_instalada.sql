-- 2026-06-12: extiende el maestro de pesos con la tabla de RENDIMIENTO de la
-- hoja 'capacidad instalada' del Plan de Capacidades (rama UNITECH/BRUCKNER).
--
-- La hoja trae, por producto acabado: peso (g/m2), ancho de rama (m) y
-- rendimiento (m/kg). gram y rend coinciden exactamente -> fuente de ingeniería
-- consistente. kg_per_unit = peso/1000 * ancho_rama (= 1/rendimiento).
--
-- De los 73 productos de la hoja, 62 ya estaban en ref_gramaje/cvu/manual y
-- coinciden. Esta migración solo llena los 7 sin peso y corrige los 4 que
-- estaban en bom_weight (familia WD038 jersey ligero + WJ070), que el BOM
-- desviaba 13-18%:
--   WD038Q46JBL166  BOM 0.0766 -> 0.0631 (-18%)
--   WD038Q46JNG166  BOM 0.0767 -> 0.0631 (-18%)
--   WD038Q46JOW166  BOM 0.0727 -> 0.0631 (-13%)
--   WJ070Q46JBL165  BOM 0.0980 -> 0.1155 (+18%)
--
-- Se respeta el guard: NO se tocan cvu (medición real), ref_gramaje ni manual.
-- WN075Q66JBL205 y XJ140Q21JGO165 tienen conflicto de ancho en esta hoja
-- (205->1.65 en vez de 2.05) pero ya están en 'manual' del maestro de Jessica
-- (kg totales del año), así que el guard los protege.

INSERT INTO public.product_kg_per_unit (odoo_product_id, kg_per_unit, source)
SELECT p.odoo_product_id, w.new_kg, 'manual'
FROM (VALUES
  ('WD038Q46JBL166',0.0631),('WD038Q46JNG166',0.0631),('WD038Q46JOW166',0.0631),
  ('WD038Q46JNT168',0.0638),('WJ038Q22JNG174',0.0661),('WJ070Q46JBL165',0.1155)
) AS w(ref, new_kg)
JOIN public.odoo_products p ON p.internal_ref = w.ref
LEFT JOIN public.product_kg_per_unit k ON k.odoo_product_id = p.odoo_product_id
WHERE k.odoo_product_id IS NULL OR k.source IN ('bom_weight','odoo_weight')
ON CONFLICT (odoo_product_id) DO UPDATE
  SET kg_per_unit = EXCLUDED.kg_per_unit, source = 'manual', updated_at = now();
