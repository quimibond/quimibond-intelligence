-- 2026-06-05k: corrige el peso de WR17066 a 170 g/m2 (areal), no lineal.
--
-- El CEO aclaró: 170 gramos por metro CUADRADO. Con ancho 1.63 m:
--   0.170 g/m2 x 1.63 m = 0.2771 kg/m (peso por metro lineal).
-- La migracion 20260605i lo habia puesto en 0.170 (interpretando g/m lineal).
--
-- Ademas: a 0.2771 kg/m el hilo del BOM (0.315 kg/m) es solo ~14% mayor que el
-- peso de la tela = merma normal de tejido. WR17066 NO tiene BOM inflada (fue
-- falsa alarma con el peso 0.170). Se revierte el pendiente a solo WC090/WJ055.

INSERT INTO public.product_kg_per_unit (odoo_product_id, kg_per_unit, source)
SELECT odoo_product_id, ROUND(0.170*1.63,4), 'manual'
FROM public.odoo_products WHERE internal_ref='WR17066JNG002163'
ON CONFLICT (odoo_product_id) DO UPDATE SET kg_per_unit=ROUND(0.170*1.63,4), source='manual', updated_at=now();

UPDATE public.odoo_pending_actions
SET title='BOMs con cantidades infladas (WC090, WJ055)',
    problem_description='WC090Q11JNT170 y WJ055Q23JNT165 tienen recetas que consumen ~10x el peso fisico de la tela -> MP recursivo inflado, margenes falsos. Error de captura en Odoo (cantidad de salida o componentes por lote vs por metro).',
    fix_in_odoo='Revisar y corregir la BOM de WC090Q11JNT170 y WJ055Q23JNT165 en Odoo: la cantidad de salida o el consumo de componentes esta capturado por lote en vez de por metro.'
WHERE action_key='bom-cantidades-infladas-wc090-wj055';
