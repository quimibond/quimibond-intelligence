-- 2026-06-05l: carga el MAESTRO DE PESOS de Jessica (archivo volumen_industrial)
-- como peso autoritativo (source='manual') para los productos donde el sistema
-- estaba adivinando mal.
--
-- Fuente: hojas 'kg totales del año' y 'CONFECCIÓN' del Excel industrial. Cada
-- producto trae gramaje (g/m2) y ancho de rama (m). Peso por metro lineal:
--   kg_per_unit = gramaje/1000 * ancho_rama
-- (idéntico a 1/Rdto de la hoja, verificado).
--
-- POR QUÉ: los productos con CÓDIGO DE RESINA (4032 / 9032 — WM4032, ZN4032,
-- WP4032, WNY4032, WNS4032, WTT4032, WR4032, WN4032) no tienen gramaje en el
-- ref, así que el sistema caía a `bom_weight` (peso recursivo de la receta).
-- El BOM SOBRE-ESTIMA estos pesos 18-44% (incluye merma de hilo + agua de la
-- receta), inflando el overhead/operación que se les reparte. El maestro da el
-- peso REAL de la tela terminada. Ejemplos del drift corregido:
--   WM4032OW152  BOM 0.1043 -> 0.0654 (-37%)
--   ZN4032BL152  BOM 0.0920 -> 0.0631 (-31%)
--   WNY4032BL151 BOM 0.2744 -> 0.2079 (-24%)
--   WTT403266NG152 BOM 0.1730 -> 0.1204 (-30%)
--   XJ14021GO165 BOM 0.4153 -> 0.2310 (-44%)  (el '21' del ref confundía al gramaje)
--
-- ALCANCE: solo se sobre-escriben los que están en `bom_weight`/`odoo_weight`
-- o sin peso. Los que ya están en `cvu` (conversión medida real en planta) o
-- `ref_gramaje` (gramaje limpio del ref) coinciden con el maestro dentro de ~5%
-- y NO se tocan: CVU es dato empírico medido y manda sobre la spec teórica.
--
-- WR180Q46JNT165 y WK300Q46JNG155 están en el maestro pero NO existen en
-- odoo_products (no se venden) -> se ignoran por el JOIN.

INSERT INTO public.product_kg_per_unit (odoo_product_id, kg_per_unit, source)
SELECT p.odoo_product_id, w.new_kg, 'manual'
FROM (VALUES
  ('WC090Q11JNT165',0.1485),('WN055Q66JNT162',0.0891),('XJ14021GO165',0.231),
  ('X140NT165',0.231),('WJ053Q22JNT150',0.0795),('WJ042Q22JNT160',0.0672),
  ('WJ060Q21JNT165',0.099),('WJ032Q22JNT155',0.0496),('WJ042Q22JNN160',0.0672),
  ('WJ053Q22JNT160',0.0848),('WJ060Q21JNT170',0.102),('WD038Q46JNT175',0.0665),
  ('WJ042Q22JNT175',0.0735),('WJ050R46JNT152',0.076),('WJ053Q22JNT170',0.0848),
  ('WJ060Q21JNT160',0.096),('WN075Q66JBL205',0.1537),('WN075Q66JBL210',0.1575),
  ('TJ085Q22JNT157',0.1335),('WJ070Q66JBL205',0.1435),('WD038Q46JNT163',0.0619),
  ('WD038Q46JNT159',0.0604),('WD038Q46JNG163',0.075),('WJ038Q22JNT160',0.0608),
  ('WJ053Q22JNT148',0.0784),('WJ053Q22JNT155',0.0822),('WJ060Q21JNT157',0.0942),
  ('WJ045Q22JNT160',0.072),('WJ053Q22JNT142',0.0753),('WK300Q46JNG155',0.465),
  ('WK100Q46JNT165',0.165),('WC120Q21JNT165',0.198),('WR135Q48JNT165',0.2228),
  ('WR180Q46JNT165',0.297),('WM4032OW152',0.0654),('WNS403266BL152',0.0946),
  ('WNS403266NG152',0.0946),('WNS403266OW152',0.0946),('WP4032GO152',0.0774),
  ('WP4032HU152',0.0774),('WP4032OW152',0.0774),('WP4032RO152',0.0774),
  ('WR4032BL152',0.0929),('WTT403266BL152',0.1204),('WTT403266NG152',0.1204),
  ('ZN4032BL152',0.0631),('ZN4032NG152',0.0631),('ZN4032OW152',0.0619),
  ('WM4032PR152',0.0654),('WM4032RP152',0.0654),('WN4032BL152',0.1072),
  ('WNY4032BL151',0.2079),('WNY4032NG151',0.2079),('WNY4032NT151',0.2079),
  ('WR4032NG152',0.0929)
) AS w(ref, new_kg)
JOIN public.odoo_products p ON p.internal_ref = w.ref
LEFT JOIN public.product_kg_per_unit k ON k.odoo_product_id = p.odoo_product_id
WHERE k.odoo_product_id IS NULL OR k.source IN ('bom_weight','odoo_weight')
ON CONFLICT (odoo_product_id) DO UPDATE
  SET kg_per_unit = EXCLUDED.kg_per_unit, source = 'manual', updated_at = now();
