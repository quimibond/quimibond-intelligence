-- 2026-06-12b: peso real de A70BL155 (entretela no tejida 155cm).
--
-- CEO confirma: pesa 70 g/m2, ancho de rama 1.55 m -> 0.070 * 1.55 = 0.1085 kg/m.
-- Estaba en bom_weight=0.1125 (cercano pero no autoritativo). source='manual'.
--
-- NOTA DE PROCESO (no es fix de código, queda documentado): A70BL155 NO pasa por
-- tintorería ni acabado/rama. Se fabrica en CARDA (consume luz) + INSPECCION. El
-- factor de fabricación blendeado del costo reconstruido le carga tejido +
-- tintorería + acabado que nunca toca -> sobre-estima su costo. Además la luz de
-- la carda hoy se asigna 100% a TEJIDO en overhead_account_assignment, no a
-- ENTRETELAS. Pendiente: ruteo de fabricación por proceso para entretelas-carda.

INSERT INTO public.product_kg_per_unit (odoo_product_id, kg_per_unit, source)
SELECT odoo_product_id, 0.1085, 'manual'
FROM public.odoo_products WHERE internal_ref='A70BL155'
ON CONFLICT (odoo_product_id) DO UPDATE
  SET kg_per_unit=0.1085, source='manual', updated_at=now();
