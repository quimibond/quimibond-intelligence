-- /sistema/odoo-pendientes — registro central de acciones pendientes en Odoo
--
-- Cada vez que el sistema descubre un patrón que requiere reconfiguración
-- en Odoo (no es un bug arreglable en silver/frontend), se registra aquí
-- con: descripción del problema, fix concreto en Odoo, workaround actual
-- en silver, impacto estimado, dueño.
--
-- Las páginas que tocan esos temas muestran un banner inline linkeando al
-- pending action. Se cierra cuando el cambio Odoo está hecho y verificado.

CREATE TABLE IF NOT EXISTS public.odoo_pending_actions (
  id bigserial PRIMARY KEY,
  -- slug estable usado para vincular desde código
  action_key text UNIQUE NOT NULL,
  -- categoría operativa: contabilidad | productos | inventario | ventas | compras
  area text NOT NULL,
  -- urgencia financiera/operativa: critical | high | medium | low
  severity text NOT NULL,
  title text NOT NULL,
  -- qué está mal hoy y por qué importa (con números si es posible)
  problem_description text NOT NULL,
  -- pasos concretos para resolver en Odoo (no genéricos)
  fix_in_odoo text NOT NULL,
  -- qué hace silver/frontend mientras tanto
  workaround_in_silver text,
  -- impacto financiero estimado por mes en MXN (NULL si no se sabe)
  estimated_impact_mxn numeric,
  -- ruta donde el CEO puede ver la evidencia
  evidence_url text,
  -- open | in_progress | resolved | wont_fix
  status text NOT NULL DEFAULT 'open',
  -- responsable nombrado
  assignee text,
  notes text,
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS ix_odoo_pending_status_severity
  ON public.odoo_pending_actions(status, severity);
CREATE INDEX IF NOT EXISTS ix_odoo_pending_area
  ON public.odoo_pending_actions(area);

-- Seed inicial — 8 issues conocidos descubiertos en la auditoría
-- (idempotente vía ON CONFLICT en action_key UNIQUE)
INSERT INTO public.odoo_pending_actions
(action_key, area, severity, title, problem_description, fix_in_odoo, workaround_in_silver, estimated_impact_mxn, evidence_url, assignee)
VALUES
(
  'reclassify-501-01-01-as-mp',
  'contabilidad',
  'high',
  '501.01.01 debe ser solo costo de MP, no auto-COGS standard',
  'Hoy 501.01.01 "Cost of sales" recibe el 99% de su monto desde "Facturas de cliente" — Odoo postea automáticamente Dr 501.01.01 / Cr 115.04.01 al standard cost del producto vendido. Como el standard cost incluye overhead embebido, el saldo está sistemáticamente inflado vs el costo real de MP. Abril 2026: 501.01.01=$6.07M vs costo MP real recursivo BOM=$4.25M, residual CAPA $1.82M.',
  '1. Crear cuenta nueva 501.01.99 "Auto-COGS Odoo (standard cost)" en el catálogo.
2. En cada categoría de producto, cambiar el campo "Income Account: Cost of Goods Sold" para que apunte a 501.01.99 en vez de 501.01.01.
3. Dejar 501.01.01 reservada exclusivamente para asientos manuales de costo MP real (cuando se hace consumo de inventario via MO).
4. Validar con un par de facturas de cliente nuevas que el COGS automático cae en 501.01.99.',
  'En el P&L limpio, 501.01.01 ya está siendo SWAP-eada con costo primo BOM (lógica correcta para los datos actuales). Una vez resuelto en Odoo, ajustar la lógica para que 501.01.99 sea la que se SWAP-e, y 501.01.01 quede como costo MP real reportable directamente.',
  1820000,
  '/contabilidad/cuenta/501.01.01?from=2026-04&to=2026-04',
  'Contadora'
),
(
  'reclassify-501-01-02-as-scrap',
  'contabilidad',
  'medium',
  '501.01.02 debe ser solo scrap/encogimientos físicos, no ajustes auto de Odoo',
  'Hoy 501.01.02 "COSTO PRIMO" recibe el 100% desde el journal "Valoración del inventario" — son ajustes automáticos de Odoo (revaluaciones, capas extras de cierre). El CEO espera que esta cuenta sea exclusivamente para scrap (mermas físicas, productos defectuosos identificados). Mezclar ambos hace imposible monitorear scrap real.',
  '1. Crear cuenta nueva 501.01.97 "Ajustes valuación auto Odoo" para los asientos automáticos del journal Valoración del inventario.
2. En la configuración del Stock Valuation Journal de Odoo, cambiar la cuenta de gasto default a 501.01.97.
3. Dejar 501.01.02 reservada para asientos manuales de scrap/encogimientos identificados (cuando se hace inventory adjustment con motivo "scrap").
4. Capacitar al equipo de almacén para que use el motivo correcto al hacer ajustes.',
  'En el P&L limpio, 501.01.02 vive en ambos contable Y limpio (asumimos costo legítimo). Cuando se separe, 501.01.97 debe excluirse del limpio O quedar como ajuste explícito.',
  1200000,
  '/contabilidad/cuenta/501.01.02?from=2026-04&to=2026-04',
  'Contadora + Gustavo Delgado'
),
(
  'capitalize-import-landed-cost',
  'compras',
  'high',
  'Capitalizar flete/aduana al producto importado vía Landed Cost',
  '504.01.0035 "GASTOS DE IMPORTACION" recibe ~$210k/mes pero parece NO estar capitalizándose al avg_cost del producto importado (no encontramos evidencia de uso del módulo Landed Cost). Resultado: el avg_cost_mxn de importados subestima sistemáticamente el costo real, e infla el margen aparente.',
  '1. Activar el módulo "Landed Costs" en Odoo (Inventory → Configuration → Settings → Landed Costs ON).
2. Configurar productos de servicio: "Flete importación", "Aduana", "Agente aduanal" como is_landed_cost=true.
3. En cada compra de importación, crear una "Landed Costs" entry vinculada al picking de entrada y prorratear el costo al producto.
4. Validar que post-cierre el avg_cost_mxn del producto importado sube por el monto del landed cost.',
  'Hoy avg_cost_mxn refleja solo costo del proveedor extranjero. Mientras se arregla, podríamos prorratear 504.01.0035 mensual contra los SKUs " I" en silver, pero introduciría complejidad. Mejor esperar fix Odoo.',
  210000,
  '/contabilidad/cuenta/504.01.0035?from=2026-04&to=2026-04',
  'Contadora + Elena Delgado'
),
(
  'dedupe-active-products',
  'productos',
  'medium',
  'Deduplicar SKUs con múltiples versiones activas (canonical apunta a inactiva)',
  'Hay al menos 4 productos vendidos con 2-4 versiones distintas en Odoo (mismo internal_ref, diferentes odoo_product_id). canonical_products tiene la versión INACTIVA, lo que rompía COGS hasta el fix BOM-recursive. Causa raíz: duplicación en Odoo cuando alguien crea producto sin verificar.',
  '1. Identificar duplicados con: SELECT internal_ref, COUNT(DISTINCT odoo_product_id) FROM odoo_products WHERE active=true GROUP BY internal_ref HAVING COUNT > 1.
2. Para cada duplicado: decidir cuál mantener como canonical.
3. Hacer merge en Odoo: Inventory → Products → Merge tool.
4. Establecer regla de unicidad en internal_ref (puede requerir custom validación en qb19).',
  'En silver, get_bom_raw_material_cost_per_unit ya costea correctamente vía BOM-recursive aunque canonical_products no tenga la versión activa. Tech debt para limpiar.',
  NULL,
  NULL,
  'Mariano + Jessica Francisco'
),
(
  'distinguish-physical-return-vs-price-nc',
  'ventas',
  'medium',
  'Distinguir notas de crédito de devolución física vs ajuste de precio',
  'Hoy todas las out_refund se procesan igual en silver: restamos COGS recursivo asumiendo que la mercancía regresó. Pero algunas NCs son solo bonificación/descuento sin movimiento físico. Magnitud abril 2026: ~$280k de NCs, mezcla de ambos tipos.',
  '1. En Odoo, asegurar que SIEMPRE que se cree NC con devolución física, sea via "Reverse" desde la factura original (genera stock_move de retorno).
2. Para NCs de bonificación sin retorno físico, usar "Credit Note Type: Discount" o etiqueta manual.
3. Idealmente agregar campo custom is_physical_return en account.move (qb19).',
  'En silver, modificar get_cogs_recursive_mp para incluir solo out_refund con stock_move asociado. Pendiente — query a stock_moves.origin timeó por tamaño, requiere índice.',
  100000,
  NULL,
  'Contadora + Guadalupe Guerrero'
),
(
  'fix-45-skus-without-avg-cost',
  'productos',
  'low',
  '45 SKUs con stock físico pero sin avg_cost_mxn',
  '45 SKUs con stock_qty > 0 pero avg_cost_mxn = NULL o 0. No contribuyen al valor físico calculado. Causas típicas: producto creado pero nunca comprado, fabricado sin standard_price, o importado sin avg_cost actualizado.',
  '1. Listar los 45 SKUs.
2. Para cada uno, decidir: si fue comprado pero no se reflejó, hacer compra de prueba; si es manufacturado, asignar standard_price; si está obsoleto, archivar y hacer write-off del stock.',
  'Ninguno — son outliers individuales.',
  NULL,
  '/inventario/conciliacion',
  'Gustavo Delgado'
),
(
  'configure-product-categories-for-variance',
  'productos',
  'medium',
  'Configurar categorías de producto para tracking de variance MP',
  'Existe mv_mo_actual_material_cost (consumo real) y mv_bom_standard_cost (BOM teórica), pero no se reporta variance. Las categorías de producto en Odoo no tienen separación clara entre input/output variance accounts.',
  '1. Crear cuentas 501.01.95 "Variance favorable producción" y 501.01.96 "Variance desfavorable producción".
2. En cada Product Category, configurar Cost Variance Account según signo.
3. Activar reportes de variance en cada cierre mensual.',
  'En silver podemos reportar variance comparando los 2 MVs sin cuentas Odoo separadas (display only). Sin la cuenta dedicada el CEO no puede conciliar contra libros.',
  NULL,
  NULL,
  'Contadora + Guadalupe Ramos'
),
(
  'separate-corp-vs-factory-overhead',
  'contabilidad',
  'low',
  'Separar overhead corporativo vs fábrica en 504.01',
  'La cuenta 504.01.0008 "RENTA DEL LOCAL" es renta de TODO (corporativo + fábrica). El P&L limpio asume 504.01 = 100% fábrica, lo que sobrestima costo de ingresos e infla margen administrativo en 6xx.',
  '1. Decidir ratio fábrica/corporativo (típicamente por m2, ej. 80/20).
2. Crear sub-cuenta 504.01.0008 (fábrica) + 613.x (corporativo).
3. Configurar asiento mensual de renta como split.
4. Aplicar a otras 504.01 con componente corpo (energía, internet, etc.).',
  'En silver podemos meter un override que prorratea 504.01.0008 80/20 entre fábrica/corpo. Introduce ratio arbitrario.',
  NULL,
  '/contabilidad/cuenta/504.01.0008?from=2026-04&to=2026-04',
  'Contadora'
)
ON CONFLICT (action_key) DO NOTHING;
