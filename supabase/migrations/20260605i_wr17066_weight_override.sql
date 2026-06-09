-- 2026-06-05i: override de peso de WR17066JNG002163 a 0.170 kg/m.
--
-- El CEO confirmó que la tela pesa 170 g por metro lineal (0.170 kg/m). El
-- bom_weight le había puesto 0.340 — pero ese 0.34 es el HILO que consume la
-- receta, NO el peso de la tela terminada. El overhead se reparte por el peso
-- de la TELA (lo que pasa por tintorería/acabado), así que va 0.170.
-- (El MP sigue saliendo del BOM = costo del hilo; es independiente del peso.)
-- A $2.18 USD el margen pasa a ~38%.

INSERT INTO public.product_kg_per_unit (odoo_product_id, kg_per_unit, source)
SELECT odoo_product_id, 0.170, 'manual'
FROM public.odoo_products WHERE internal_ref='WR17066JNG002163'
ON CONFLICT (odoo_product_id) DO UPDATE SET kg_per_unit=0.170, source='manual', updated_at=now();
