-- Pending actions: auditoría profunda inventario ↔ contabilidad (2026-07-02)
--
-- Fuente: docs/audit-2026-07-02-inventario-contabilidad.md
-- Hallazgos verificados contra GL vigente (odoo_account_balances, rebuild
-- completo horario) + asientos (odoo_account_entries_stock) + stock moves
-- (canonical_stock_moves) el 2026-07-02.
--
-- Inserta 5 acciones nuevas (idempotente por action_key UNIQUE) y anota la
-- acción existente de revaluación PT para vincularla al programa completo.

INSERT INTO public.odoo_pending_actions
(action_key, area, severity, title, problem_description, fix_in_odoo, workaround_in_silver, estimated_impact_mxn, evidence_url, assignee)
VALUES
(
  'cuentas-valuacion-categoria-realinear',
  'contabilidad',
  'critical',
  'Realinear cuenta de valuación por categoría de producto (115.01.01 negativa, ventas desde WIP)',
  'El mapa categoría de producto → cuenta de valuación está roto en dos formas:
1. Productos VENDIBLES viven en categorías "Producto en Proceso / *" (Acabado, Carda, Importación) cuya cuenta de valuación es 115.03.01 Producción en proceso. Al facturarlos, el COGS se alivia desde el WIP: $2.4M de costo vendido salió de 115.03.01 vía facturas de cliente solo abril–junio 2026.
2. En JUNIO 2026 varias categorías (Tejido Circular sin resina, Subproducto, y varias "en Proceso") se cambiaron a la cuenta 115.01.01 "Inventario" SIN asiento de transferencia de saldos: las salidas se acreditan en 115.01.01 pero el stock entró históricamente por 115.03/115.04. Resultado: 115.01.01 nació NEGATIVA (−$2.0M al 30-jun, −$3.14M al 2-jul y bajando). Una cuenta de inventario nunca puede ser negativa.
Además apareció 115.04.03 en mayo (facturas de proveedor) que luego desapareció del GL por reclasificaciones posteriores.',
  '1. Definir el mapa OFICIAL (una sola vez, con la contadora):
   - Toda categoría de producto vendible (telas, entretelas, subproductos, importados) → valuación 115.04.01 Productos terminados.
   - Materias primas (hilo, químicos, resina, fibra) → 115.02.01.
   - Refacciones/consumibles → 115.02.02 (ver acción refacciones-fuera-ciclo-textil).
   - 115.03.01 SOLO para WIP automático de MOs (no como cuenta de valuación de ninguna categoría).
   - Decidir si 115.01.01 se depreca (recomendado: dejarla en cero y desactivarla) o se vuelve la única cuenta de PT — pero NO mixto.
2. En Inventario → Configuración → Categorías de producto: corregir cuenta de valuación, cuenta de entrada/salida de stock de CADA categoría según el mapa.
3. Por cada categoría cambiada: asiento de transferencia de saldo (valor del stock on-hand de esa categoría) de la cuenta vieja a la nueva, mismo día del cambio. Esto lleva 115.01.01 a su valor real (positivo) y saca de 115.03/115.04 lo que ya no les corresponde.
4. Regla operativa: cambiar la cuenta de valuación de una categoría REQUIERE su asiento de transferencia el mismo día.',
  'La conciliación física-contable de /inventario/conciliacion y la invariante nueva inventory.negative_bucket (plan fase 4) flaggean saldos 115.x negativos. Silver no puede corregir la causa: es 100% configuración de Odoo.',
  3140672,
  '/contabilidad',
  'Contadora + Mariano'
),
(
  'capa-valoracion-manual-detener',
  'contabilidad',
  'critical',
  'Detener asientos manuales CAPA DE VALORACIÓN y depurar WIP ($13.5M estacionados en 115.03.01)',
  'El journal "CAPA DE VALORACIÓN" sigue VIVO en 2026 — contradice la premisa documentada de que el mecanismo CAPA murió con el archivado de RSI56 (1-abr-2026). Cada mes carga inventario contra crédito a 501.01.01 Costo de venta:
- Ene $3.60M, Feb $2.88M, Mar $3.64M, Abr $2.26M, May $1.08M (todo a 115.03.01 WIP) y Jun $1.61M (a 115.04.01 PT). Neto 2026: $15.07M de costos sacados del P&L y estacionados en inventario.
- El saldo de 115.03.01 ($15.45M al 30-jun) es ~87% estos asientos manuales, NO producción en proceso real: solo hay ~50 MOs abiertas (32 progress + 18 to_close).
- En 2024–2025 el mismo journal acreditó 501.01.01 por $35.9M y $48.7M contra cuentas fuera del scope 115/501/504 (verificar contrapartida histórica).
El efecto es que el P&L 2026 muestra un costo de ventas ~$15M menor al real (o el inventario está inflado por ese monto, según qué porción sea capitalizable de verdad).',
  '1. CONGELAR el journal CAPA DE VALORACIÓN: no más asientos manuales COGS→inventario. La absorción real la darán los workcenters (acción configure-workcenters-acabado-tintoreria-entretelas).
2. Con la contadora, depurar los $13.46M de 2026 en 115.03.01 asiento por asiento (23+20+28+2+1 asientos): determinar qué porción corresponde a costo que YA salió por ventas (→ reconocer en 501.01.01 del período) y qué porción es inventario real al cierre (→ transferir a 115.04.01 dentro de la revaluación).
3. Meta: 115.03.01 = solo el valor de las MOs abiertas al corte (materiales consumidos − producción entregada), verificable contra el reporte de MOs de Odoo.
4. Documentar la política: el WIP lo mueve SOLO la valuación automática de manufactura.',
  'gold_pl_statement y el P&L de /finanzas leen el GL tal cual, así que hoy heredan la distorsión. La fila "Δ vs P&L contable" del P&L limpio ya aísla parte del efecto. La invariante nueva capa_journal_activity (plan fase 4) alertará cada asiento nuevo en ese journal.',
  15068423,
  '/contabilidad',
  'Contadora + CEO'
),
(
  'conteo-junio-reclasificado-999998',
  'contabilidad',
  'critical',
  'Conteo físico junio: $3.57M reclasificados a equity (999998) — revertir a cuenta correcta',
  'El conteo físico masivo de junio 2026 (1,384 movimientos de ajuste, $38.5M de valor bruto tocado) generó originalmente cargos por $6.42M y abonos por $1.57M en 501.01.08 DIFERENCIAS POR CONTEO (asientos STJ: 0435 $2.58M, 0617 $1.99M, 0434/1987/2323 $1.29M c/u, etc.). Después, esos asientos se EDITARON en sitio: en el GL vigente 501.01.08 de junio quedó en $31 y apareció un cargo de $3.57M a 999998 "Ganancias/pérdidas no distribuidas" (cuenta de equity que solo debe mover el cierre anual automático de Odoo) más créditos netos removidos de 115.01.01.
Problemas: (a) la merma/sobrante real del conteo quedó fuera del P&L y dentro de equity — el resultado 2026 no refleja el conteo; (b) editar asientos posteados rompe la trazabilidad (silver detectó el hueco porque lines_stock quedó con la versión vieja); (c) SAT/auditoría externa: mover resultados a equity directamente es observable.',
  '1. Obtener el detalle del asiento/edición que cargó $3.57M a 999998 (Contabilidad → apuntes, cuenta 999998, junio 2026).
2. Revertir vía ASIENTO DE RECLASIFICACIÓN (no edición): 999998 → la cuenta que corresponda según el análisis del conteo:
   - merma física real de textil → 501.01.08 (sí es P&L; si el monto es material, evaluar presentarlo como partida extraordinaria),
   - correcciones de errores de captura histórica (qty nunca existió) → puede corresponder ajustar contra la depuración de WIP/CAPA (acción capa-valoracion-manual-detener) en lugar de P&L,
   - faltantes de refacciones/maquinaria → gasto de mantenimiento/activo, no 501.01.08 (acción refacciones-fuera-ciclo-textil).
3. Política permanente: los asientos de Valoración del inventario (STJ) NUNCA se editan posteados; toda corrección es un asiento nuevo de reclasificación con ref al original, en el mes corriente.',
  'El fix de qb19 (line_ids.write_date en el incremental de _push_account_entries_stock, 2026-07-02) hace que futuras ediciones de líneas sí se re-sinquen; para el histórico hay que re-push heavy desde 2026-06-01. La invariante nueva equity_manual_posting (plan fase 4) alertará movimientos manuales a 999998.',
  3571753,
  '/contabilidad',
  'Contadora + CEO'
),
(
  'refacciones-fuera-ciclo-textil',
  'contabilidad',
  'high',
  'Sacar refacciones y activo fijo del ciclo de inventario textil (doble vía de capitalización + conteos a COGS)',
  'Las refacciones y activos conviven con el inventario textil valuado y contaminan tanto el COGS como el inventario:
1. DOBLE VÍA de capitalización: (a) asiento manual mensual en "Operaciones varias" cargando 115.02.02 Inventario refacciones ($306k ene, $906k feb, $623k mar, $1.02M abr…) y (b) facturas de proveedor capitalizando directo a 115.04.03 (52 asientos en mayo por $352k; cuenta que luego desapareció del GL por más reclasificaciones). Con las compras también pasando por TVAR, ya existe la duplicación medida en refacciones-tvar-doble-conteo-501-01-02 ($4.15M YTD).
2. Los conteos y consumos de refacciones/maquinaria caen a 501.01.08 dentro del costo de ventas (junio: $663k; abril: $254k; ya flaggeado en conteo-maquinaria-refacciones-en-cogs $1.63M).
3. Activo fijo clasificado como consumible infla inventario $4.11M (acción activo-fijo-clasificado-como-inventario).
Esta acción es el FIX DE RAÍZ de configuración que resuelve las tres anteriores.',
  '1. Categoría "Refacciones" en Odoo con: valuación automática → 115.02.02, y cuenta de GASTO al consumir → 504.01.xx mantenimiento (NO 501.01.08, NO 501.01.02).
2. UNA sola vía de entrada: la factura del proveedor capitaliza a 115.02.02 vía la categoría. ELIMINAR el asiento manual mensual de Operaciones varias.
3. Ubicación de inventario separada para refacciones con su propia cuenta de ajuste (mantenimiento) — así los conteos de refacciones nunca tocan 501.01.08.
4. Maquinaria/equipo: ficha de activo fijo (depreciación), no producto almacenable.
5. Revisar el ajuste manual acumulado en 115.02.02 ($3.36M) contra el físico de refacciones (~$2.74M a avg_cost): diferencia ~$0.6M a depurar.',
  'get_refacciones_dup_501_01_08 y get_inventory_to_cost_dup_501_01_02 ya miden los síntomas mes a mes; el P&L limpio los descuenta como workaround. Cuando el fix esté en Odoo, esos RPCs deben tender a cero.',
  4154994,
  '/contabilidad',
  'Contadora + Elena Delgado + Gustavo Delgado'
),
(
  'revaluacion-inventario-costo-reconstruido',
  'contabilidad',
  'high',
  'Programa de revaluación de inventario al costo reconstruido (cuadre GL = físico al centavo)',
  'Objetivo del CEO: que el GL de inventario cuadre al centavo con el inventario físico valuado al costo correcto (reconstruido). Estado al 2026-07-02:
- GL 115.* (30-jun): $51.62M = 115.01 −$2.00M + 115.02.01 $20.60M + 115.02.02 $3.36M + 115.03 $15.45M + 115.04 $14.21M.
- Físico Odoo (stock_qty × avg_cost, 1,313 SKUs): $43.12M — el gap contra GL son los asientos manuales (CAPA, refacciones, reclasificaciones), NO la valuación automática.
- Físico a costo RECONSTRUIDO: PT/vendibles en catálogo (522 SKUs): $11.95M AVCO vs $8.03M a MP-último-costo vs $17.76M a MP+fabricación absorbida. MP/otros (791 SKUs): $31.17M AVCO vs ~$39.03M a último costo de compra (457 con compra reciente; validar UoM por SKU antes de usar).
- 4 SKUs con stock negativo (−$492k) y 15 SKUs con stock sin costo deben corregirse antes de revaluar.
PREREQUISITOS: cuentas-valuacion-categoria-realinear + capa-valoracion-manual-detener + refacciones-fuera-ciclo-textil + conteo-junio-reclasificado-999998 (si se revalúa sobre la estructura rota, el cuadre es imposible).',
  '1. DECISIÓN DE POLÍTICA (CEO): valuar PT a MP+fabricación absorbida (absorbing, recomendado: +$5.8M vs AVCO actual, consistente con /contabilidad/costo-reconstruido) o a MP-último-costo (variable costing: −$3.9M). MP siempre a último costo de compra. Saldo/desperdicio/subproducto a $0 (política ya definida). Refacciones a costo de compra.
2. Validar costo objetivo por SKU: top ~200 SKUs cubren >90% del valor; el resto por familia. Fuente: product_cost_catalog (mp_unit_mxn, fab_absorbido_unit_mxn) + última compra para MP (cuidado con UoM compra≠stock).
3. Corregir stock negativo (4 SKUs) y SKUs sin costo (15) en Odoo.
4. Ejecutar en Odoo 19 AVCO por producto: Inventario → Valuación → "Actualizar costo" (revaluación) con la cuenta de contrapartida acordada con la contadora (recomendado: subcuenta nueva 501.01.09 "Revaluación de inventario" para el efecto P&L, o directo contra la depuración de CAPA cuando aplique). Hacerlo por lote vía import/script de shell — el sistema puede generar el CSV producto→costo_nuevo desde product_cost_catalog.
5. Cierre: verificar GL 115.x = Σ stock_qty × costo_nuevo por bucket, AL CENTAVO. La invariante inventory.gl_vs_physical_drift (tolerancia $50k, luego $1) queda vigilando.
6. Cadencia: repetir trimestral hasta que los workcenters de Acabado/Tintorería/Entretelas absorban solos (entonces AVCO se auto-mantiene).',
  'La página /inventario/conciliacion compara GL vs físico on-read. El catálogo product_cost_catalog (refresh nocturno) es la fuente del costo objetivo. Falta construir: export CSV de revaluación + invariante de drift diaria (fase 4 del plan).',
  8500000,
  '/contabilidad/costo-reconstruido',
  'CEO + Contadora + Mariano'
)
ON CONFLICT (action_key) DO NOTHING;

-- Vincular la acción existente de PT contaminado al programa completo
UPDATE public.odoo_pending_actions
SET notes = COALESCE(notes, '') ||
  E'\n\n[2026-07-02] Subsumida en el programa revaluacion-inventario-costo-reconstruido (auditoría docs/audit-2026-07-02-inventario-contabilidad.md): la revaluación al costo reconstruido resuelve la contaminación AVCO del PT como caso particular.'
WHERE action_key = 'revaluar-inventario-pt-contaminacion-avco'
  AND (notes IS NULL OR notes NOT LIKE '%2026-07-02%');
