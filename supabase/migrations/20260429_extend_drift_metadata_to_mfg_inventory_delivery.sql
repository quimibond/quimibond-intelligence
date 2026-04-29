-- Extender odoo_sat_drift_invariant_metadata para cubrir invariants no-invoice
-- residuales con >100 issues open. La función detect_invoice_drift_insights()
-- los procesa automáticamente (loop sobre la tabla). Genera 1 insight agregado
-- por cada invariant_key con count + sample + impact + recommendation.

INSERT INTO odoo_sat_drift_invariant_metadata
  (invariant_key, insight_severity, human_title_template, human_description, human_recommendation)
VALUES
  ('manufacturing.material_cost_variance', 'high',
   '%s órdenes de manufactura con variance de costo',
   'Manufactura donde el costo real de materiales difiere significativamente del costo BOM. Indica desviación en consumo, mermas no registradas, o BOMs desactualizados.',
   'En Odoo: revisar las MOs en Manufacturing > Operations > Manufacturing Orders. Comparar consumo real vs BOM esperado. Actualizar BOM o investigar mermas/desperdicio.'),
  ('manufacturing.consumption_outside_bom', 'medium',
   '%s consumos de materiales fuera del BOM',
   'Materiales consumidos en MOs que NO están en la BOM definida. Indica BOMs incompletos o consumo manual sin actualizar la BOM.',
   'En Odoo (Manufacturing > Bills of Materials): agregar los componentes faltantes a la BOM o registrar como scrap si fue desperdicio.'),
  ('inventory.accounting_without_move', 'medium',
   '%s asientos contables sin movimiento de inventario',
   'Asientos en cuentas de inventario (1115*, 504*, etc.) que no tienen un stock.move asociado. Después de los exclusion journals (CAPA VALORACIÓN, NOMINAS, etc.), estos son los reales — pueden ser ajustes manuales no reflejados en stock.',
   'En Odoo: revisar los account.move correspondientes (Accounting > Journal Entries). Crear el stock.move equivalente o reclasificar el asiento si fue error contable.'),
  ('inventory.move_without_accounting', 'high',
   '%s movimientos de inventario sin asiento contable',
   'Stock moves done que no generaron account.move. Inventario sin reflejo contable — la valoración del stock no cuadra con el ledger.',
   'En Odoo: forzar la valoración del stock (Inventory > Operations > Run Inventory Valuation) o investigar cuál move no se contabilizó. Cierre contable mensual debería detectarlos.'),
  ('delivery.late_active', 'medium',
   '%s entregas atrasadas activas',
   'Pickings (stock.picking) con state=assigned/confirmed cuya scheduled_date ya pasó. NO incluye las que ya tienen auto-resolver por delivery completada.',
   'En Operaciones: priorizar embarque o cancelar la SO si ya no es viable. Si la fecha cambió, actualizarla en la SO.'),
  ('payment.date_mismatch', 'low',
   '%s pagos con fecha distinta entre Odoo y SAT',
   'La fecha del bank payment en Odoo difiere de fecha_pago del CFDI complemento. Puede afectar reportes de antigüedad y conciliación bancaria.',
   'En Odoo: alinear la fecha del payment con la del CFDI (la fiscalmente vinculante).'),
  ('order.orphan_delivery', 'medium',
   '%s órdenes de venta operativas sin entregas',
   'SOs en state=sale en ventana 14-90d con cantidades pendientes de entrega. NO incluye SOs viejas/abandonadas (filtradas por auto-resolver).',
   'En Odoo (Sales > Orders): forzar el delivery picking, mover a state=done si ya entregaste fuera del sistema, o cancelar la SO si el cliente desistió.'),
  ('entity_unresolved_30d', 'low',
   '%s entidades sin resolver hace >30d',
   'Entities (companies/contacts/products) detectadas en datos crudos pero no canonicalizadas hace más de 30 días. Probablemente requieren matcher manual o información adicional.',
   'En la tabla canonical_companies/contacts/products: revisar manualmente y crear shadow row con override si es entidad legítima. Si es noise, archivar.'),
  ('mfg.stock_drift', 'medium',
   '%s órdenes de manufactura con stock drift',
   'MOs done donde stock_qty del producto bajó >50% en los 14d post-MO. Indica que se vendió/consumió rápido (operativo OK) o que hay sangre en inventario (auditar).',
   'En Odoo: revisar el flujo de salidas del producto post-MO. Si es venta normal, ignorar. Si es ajuste/merma no registrada, hacer inventory adjustment.')
ON CONFLICT (invariant_key) DO UPDATE SET
  insight_severity = EXCLUDED.insight_severity,
  human_title_template = EXCLUDED.human_title_template,
  human_description = EXCLUDED.human_description,
  human_recommendation = EXCLUDED.human_recommendation;
