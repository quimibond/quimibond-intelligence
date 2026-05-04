-- Pending actions de auditoría 2026-05-04 PM
--
-- Hallazgos del deep-dive producto-por-producto / BOM / stock-move /
-- asiento contable. Resumen de findings:
--
-- 🚨 CRÍTICO: la premisa del "P&L LIMPIO" está equivocada. El BOM-recursivo
-- NO incluye MOD+OH absorbido al producto al producirse — solo MP. El gap
-- entre 501.01.01 y BOM-recursivo (que tratábamos como "CAPA inflada") es
-- de hecho MOD+OH legítimamente absorbido al inventario. Hacer swap
-- 501.01.01 ↔ BOM doble-resta MOD+OH.
--
-- Otros hallazgos: BOMs vacías priorizadas (corregido en silver), 89
-- productos con multi-BOM activa, 82 hojas sin costo, 14 productos vendidos
-- sin canonical, método de valuación Odoo a verificar con contadora.

INSERT INTO public.odoo_pending_actions
(action_key, area, severity, title, problem_description, fix_in_odoo, workaround_in_silver, estimated_impact_mxn, evidence_url, assignee)
VALUES
(
  'reinterpret-pnl-limpio-mod-oh',
  'contabilidad',
  'critical',
  'Reinterpretar el "P&L limpio": el BOM-recursivo NO incluye MOD+OH absorbido',
  'Auditoría 2026-05-04 PM revela que la premisa del P&L LIMPIO está equivocada. El sistema swap-eaba 501.01.01 (contable) ↔ BOM-recursivo y trataba la diferencia como "CAPA inflada pendiente". Evidencia abril 2026:
- Stock moves de venta (real cost lote despachado): $6.68M
- COGS posteado a 501.01.01: $6.60M (cuadra con stock_moves al 99%)
- BOM-recursivo (solo MP): $4.25M
- Gap: $2.35M (35%)

El gap NO es overhead duplicado. Es MOD + Overhead absorbido al producto al producirse (parte del costo del PT). Ejemplo X140NT165: standard_price $18.62 = BOM puro $15.54 + MOD/OH absorbido $3.08 (16.5%).

Resultado: el P&L LIMPIO actual SUB-reporta utilidad por ~$2-3M/mes (double-counting de MOD+OH como gasto separado y como costo absorbido).',
  'Decisión a tomar con contadora — no es Odoo per se. Tres opciones:

OPCIÓN A: Eliminar el "P&L limpio" — usar solo el contable (501.01.01 post-CAPA mensual).

OPCIÓN B (RECOMENDADA): Renombrar y separar.
- "COGS contable" sigue siendo el costo total absorbido (MP + MOD + OH).
- "Margen contributivo material" (ventas − BOM-recursivo) se reporta APARTE como métrica de eficiencia material, NO como utilidad.
- Quitar el "swap" entre 501.01.01 y BOM-recursivo en la tabla limpia.

OPCIÓN C: Construir BOM completo con MOD+OH asignado por hora-máquina y por unidad. Requiere data adicional (rates) que no tenemos hoy.',
  'Hoy el reporte mensual y /contabilidad muestran un "P&L limpio" que sub-reporta utilidad. Pendiente: marcar páginas con banner "interpretación bajo revisión".',
  2350000,
  '/contabilidad?tab=estado',
  'Contadora + CEO'
),
(
  'fix-bom-empty-priority',
  'productos',
  'medium',
  'BOMs activas vacías: priorizar las que tienen líneas (silver: RESUELTO)',
  '7 productos tenían BOMs activas múltiples donde la "primera" por orden estaba vacía. Solo 1 vendido en 2026 (IWR130Q46JAZ155 — $13.5k). RESUELTO 2026-05-04 PM en silver: get_bom_raw_material_cost_per_unit ahora prioriza num_lines > 0 antes de criterios de orden.

Subyacente: hay 31 BOMs activas vacías en Odoo en 26 productos distintos. Son placeholders de "DESARROLLOS / GENÉRICO" que deberían archivarse o tener líneas reales.',
  '1. En Odoo, ir a Manufacturing → Bills of Materials.
2. Filtro: Active=true AND Components count=0.
3. Para cada BOM vacía:
   a) Si es placeholder de desarrollo → archivar.
   b) Si debería tener líneas → llenarlas con la receta real.
4. Capacitar a Guadalupe Ramos para no dejar BOMs vacías activas (usar Draft state).
5. Considerar regla en qb19: bloquear active=true en BOM con 0 líneas.',
  'RESUELTO en silver. Limpiar Odoo evita confusión humana y bug similar en otros lugares del sistema.',
  NULL,
  NULL,
  'Guadalupe Ramos + Mariano'
),
(
  'merge-multi-active-boms',
  'productos',
  'medium',
  'Productos con 2+ BOMs activas (89 productos)',
  'Hay 89 productos con 2 o más BOMs marcadas active=true en Odoo. La función BOM-recursivo escoge UNA por criterio determinístico, pero esto es ambiguo si las múltiples BOMs tienen contenido distinto: ¿cuál es la "verdadera"? Riesgo: el cálculo de costo no representa la receta real usada en producción.',
  '1. Listar productos con multi-BOM activa:
   SELECT odoo_product_id, COUNT(*) FROM mrp_boms WHERE active=true GROUP BY odoo_product_id HAVING COUNT(*)>1;

2. Para cada producto, decidir cuál BOM es la versión "actual":
   a) Revisar con Guadalupe Ramos / Producción cuál se está usando físicamente.
   b) Las demás → archivar (active=false) en Odoo.

3. Establecer convención: solo 1 BOM activa por producto. Versiones anteriores → archivadas con código de versión en el campo "code".

4. Considerar validación en qb19 que bloquee crear BOM activa si ya hay otra activa para el mismo producto.',
  'Función actual selecciona una con criterio determinístico (líneas > 0, code='''', menor id). No falla pero puede no representar la receta real.',
  NULL,
  NULL,
  'Guadalupe Ramos + Mariano'
),
(
  'assign-cost-to-bom-leaves',
  'productos',
  'high',
  '82 componentes hoja en BOMs sin standard_price ni avg_cost',
  'De 317 productos que son LEAVES (sin BOM, son MP comprada) usadas en BOMs activas, 100 no tienen avg_cost_mxn en canonical. De esas, 82 tampoco tienen standard_price > 0 en Odoo. El cálculo BOM-recursivo asigna $0 a esas hojas → cualquier producto que las use en su BOM tiene costo subreportado por la parte que viene de esas hojas.',
  '1. Listar las 82 hojas sin costo:
   SELECT op.internal_ref, op.name, op.active
   FROM odoo_products op
   WHERE op.odoo_product_id IN (
     SELECT DISTINCT bl.odoo_product_id FROM mrp_bom_lines bl
     JOIN mrp_boms b ON b.odoo_bom_id=bl.odoo_bom_id AND b.active
     WHERE NOT EXISTS (SELECT 1 FROM mrp_boms b2 WHERE b2.active AND b2.odoo_product_id=bl.odoo_product_id)
   ) AND (op.standard_price IS NULL OR op.standard_price=0);

2. Para cada uno, decidir:
   a) Si es producto comprado activo: hacer compra de prueba para que Odoo registre avg_cost. O capturar standard_price manualmente con el último costo de compra conocido.
   b) Si es desarrollo / inactivo: archivar el producto.

3. Configurar regla: cualquier producto con tipo=consumable o storable DEBE tener standard_price > 0 antes de usarse en BOMs.',
  'Hojas sin costo contribuyen 0 al BOM-recursivo. Magnitud del impacto en cálculos depende del uso de cada hoja en BOMs activas; auditar caso por caso.',
  NULL,
  NULL,
  'Gustavo Delgado + Elena Delgado'
),
(
  'investigate-real-cost-method',
  'contabilidad',
  'high',
  'Confirmar con contadora: método de valuación de inventario (Standard / AVCO / FIFO)',
  'Evidencia abril 2026: el COGS posteado a 501.01.01 cuadra con value de stock_moves de venta (diff <1.2%) pero NO cuadra con qty × standard_price. Ratio sistemático COGS unit ≈ 30-40% del standard_price para 78/78 SKUs vendidos.

Sospecha: Quimibond usa AVCO o FIFO con costo histórico, mientras que canonical_products.avg_cost_mxn refleja standard_price snapshot.

Implicación crítica: si el método es AVCO/FIFO, entonces:
1. standard_price NO es el costo real al despachar.
2. avg_cost_mxn que copiamos a canonical NO es el costo correcto para BOM-recursivo.
3. BOM-recursivo está MAL en ambas direcciones (sobre o subestima dependiendo de tendencia precios MP).',
  'PASOS PARA CONFIRMAR:

1. Pedir a contadora confirmación del método de valuación configurado:
   - Odoo: Inventory → Configuration → Settings → Inventory Valuation
   - Posibles valores: Standard Price, Average Cost (AVCO), First In First Out (FIFO)

2. Si es AVCO o FIFO:
   - El campo standard_price es solo informativo.
   - Necesitamos otro campo / cálculo para BOM-recursivo:
     a) Pull el precio de la última compra vía odoo_purchase_orders + lines.
     b) O calcular el moving average dinámico.

3. Si es Standard Price:
   - Validar por qué hay gap entre standard_price y COGS posteado.
   - Posiblemente product_categ_id.property_cost_method es distinto a producto-level.

4. Documentar el método correcto y ajustar canonical_products.avg_cost_mxn para que refleje el "costo real al despachar".',
  'BOM-recursivo actualmente usa avg_cost_mxn = standard_price. Si el método real es AVCO/FIFO, este valor está mal. Mientras se valida, todo cálculo de "costo MP real" vía BOM debe leerse con cautela.',
  NULL,
  '/contabilidad/cuenta/501.01.01?from=2026-04&to=2026-04',
  'Contadora + Mariano'
),
(
  'audit-canonical-products-coverage',
  'productos',
  'medium',
  'Resync canonical_products: 14 productos vendidos sin entry, 484 apuntando a inactivos',
  'Auditoría detectó 2 problemas de cobertura en canonical_products:
1. 14 productos vendidos en 2026 NO tienen entry en canonical_products (versiones nuevas / activas que no se sincronizaron).
2. 484 entries en canonical_products apuntan a un odoo_product_id que está INACTIVO en Odoo (versiones viejas).

Impacto: el BOM-recursivo busca avg_cost en canonical por odoo_product_id; si el ID activo no está en canonical, falla. La función ya tiene fallback decente pero la data debería estar limpia.',
  '1. Para los 14 productos vendidos sin canonical, ejecutar matcher_product manualmente:
   SELECT matcher_product(internal_ref, name) FROM odoo_products WHERE odoo_product_id IN (...);

2. Para los 484 que apuntan a inactivos, decidir caso por caso:
   a) Si el internal_ref tiene una versión ACTIVA distinta → repunte canonical_products.odoo_product_id al activo.
   b) Si el internal_ref ya no existe activo → archive canonical_products entry o mantenerla histórica.

3. CAUSA RAÍZ EN ODOO: cuando alguien duplica un producto en Odoo (en lugar de editar el existente), crea un odoo_product_id nuevo. canonical_products no se actualiza automáticamente al ID nuevo.

4. Configurar trigger en bronze que cuando se inserte un producto en odoo_products con internal_ref existente en canonical, RE-PUNTE canonical al activo.',
  'matcher_product corre cada 2h vía pg_cron silver_sp3_matcher_all_pending. Los 14 faltantes deberían entrar en próximo run. Los 484 que apuntan a inactivos requieren update manual.',
  NULL,
  NULL,
  'Mariano + Jessica Francisco'
)
ON CONFLICT (action_key) DO UPDATE SET
  title = EXCLUDED.title,
  problem_description = EXCLUDED.problem_description,
  fix_in_odoo = EXCLUDED.fix_in_odoo,
  workaround_in_silver = EXCLUDED.workaround_in_silver,
  estimated_impact_mxn = EXCLUDED.estimated_impact_mxn,
  evidence_url = EXCLUDED.evidence_url;
