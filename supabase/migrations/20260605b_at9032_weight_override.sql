-- 2026-06-05b: override manual del peso de AT9032BL152 (y su importado).
--
-- El CEO confirma que AT9032 pesa 72 g/m² YA CON RESINA (no es tela pesada).
-- La conversión CVU 1:1 lo había medido en 0.244 kg/m (~2× inflado, probable
-- rollo doblado / orden de conversión mal medida); fue el único outlier de CVU
-- (ratio 2.06 vs BOM; el resto de productos CVU cae en 0.80–1.04 vs BOM).
-- Ese peso inflado le duplicaba fab+op y daba un margen falso de −101%.
--
-- Fix: peso = 72 g/m² × 1.52 m = 0.1094 kg/m, source='manual' (sobrevive los
-- re-seeds de product_kg_per_unit). El importado AT9032BL152 I (misma tela)
-- toma el mismo valor. Resultado: margen feb-2026 −101.7% → −16.5% (producto
-- marginal realista, no catastrófico).

INSERT INTO public.product_kg_per_unit (odoo_product_id, kg_per_unit, source)
SELECT op.odoo_product_id, ROUND(0.072 * 1.52, 4), 'manual'
FROM public.odoo_products op
WHERE op.internal_ref IN ('AT9032BL152', 'AT9032BL152 I') AND op.uom = 'm'
ON CONFLICT (odoo_product_id) DO UPDATE
  SET kg_per_unit = EXCLUDED.kg_per_unit, source = 'manual', updated_at = now();
